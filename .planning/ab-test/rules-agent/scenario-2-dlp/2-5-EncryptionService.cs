using System.Security.Cryptography;
using Dlp.Keys;

namespace Dlp.Keys;

/// <summary>
///     Opaque identifier for a key managed by the key provider. Wraps the
///     string id used in the on-disk schema so callers can't accidentally
///     pass a key name as, e.g., a ciphertext length.
/// </summary>
/// <param name="Value">String id from the on-disk key schema.</param>
public readonly record struct KeyId(string Value)
{
    /// <inheritdoc />
    public override string ToString() => Value;
}

/// <summary>
///     Provides a 256-bit AES key for the requested <see cref="KeyId" />.
/// </summary>
public interface IKeyProvider
{
    /// <summary>Returns the symmetric key bytes for <paramref name="keyId" />.</summary>
    /// <param name="keyId">Target key identifier.</param>
    /// <param name="cancellationToken">Forwarded to the underlying I/O.</param>
    /// <exception cref="KeyNotFoundException">Thrown when <paramref name="keyId" /> is unknown.</exception>
    /// <exception cref="KeyRetiredException">Thrown when <paramref name="keyId" /> is retired.</exception>
    public Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken cancellationToken = default);
}

/// <summary>
///     Thrown when a <see cref="KeyId" /> does not match any entry in the
///     on-disk store. Stable <see cref="Code" /> for the global exception handler.
/// </summary>
public sealed class KeyNotFoundException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "dlp.key.not_found";

    public KeyNotFoundException(KeyId keyId)
        : base($"Key '{keyId}' was not found in the store.")
    {
    }
}

/// <summary>
///     Thrown when a <see cref="KeyId" /> is retired (its <c>RetiredAt</c>
///     timestamp is in the past). Stable <see cref="Code" />.
/// </summary>
public sealed class KeyRetiredException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "dlp.key.retired";

    public KeyRetiredException(KeyId keyId, DateTimeOffset retiredAt)
        : base($"Key '{keyId}' was retired at {retiredAt:o}.")
    {
    }
}

/// <summary>
///     Configures the AES-GCM parameters used by <see cref="EncryptionService" />.
///     Bound from <c>appsettings.json</c> section <c>Dlp:Encryption</c>.
/// </summary>
public sealed class EncryptionOptions
{
    public const string SectionName = "Dlp:Encryption";

    /// <summary>Nonce size in bytes (default 12, per NIST SP 800-38D §8.2.1).</summary>
    public int NonceSize { get; init; } = 12;

    /// <summary>Authentication tag size in bytes (default 16, per NIST SP 800-38D §5.2.1.2).</summary>
    public int TagSize { get; init; } = 16;

    /// <summary>Required key size in bytes (default 32 for AES-256).</summary>
    public int KeySize { get; init; } = 32;

    /// <summary>
    ///     Builds a per-call <see cref="EncryptionLayout" /> for a payload of
    ///     <paramref name="payloadLength" /> bytes. Use this when a caller
    ///     needs a custom nonce/tag combination.
    /// </summary>
    /// <param name="payloadLength">Plaintext length in bytes.</param>
    public EncryptionLayout CreateLayout(int payloadLength) =>
        new(NonceSize: NonceSize, TagSize: TagSize, PayloadLength: payloadLength);
}

/// <summary>
///     Per-call AES-GCM layout. <see cref="TotalLength" /> is the on-wire size
///     of an <c>EncryptAsync</c> output blob (nonce + ciphertext + tag).
/// </summary>
/// <param name="NonceSize">Bytes reserved for the nonce.</param>
/// <param name="TagSize">Bytes reserved for the authentication tag.</param>
/// <param name="PayloadLength">Bytes of ciphertext (== plaintext length).</param>
public readonly record struct EncryptionLayout(int NonceSize, int TagSize, int PayloadLength)
{
    /// <summary>Total on-wire size of an <c>EncryptAsync</c> output.</summary>
    public int TotalLength => NonceSize + PayloadLength + TagSize;
}

/// <summary>
///     Encrypts and decrypts payloads with AES-GCM using a key fetched from
///     the provider. Output format: <c>nonce ‖ ciphertext ‖ tag</c>.
/// </summary>
/// <param name="keyProvider">Source of symmetric keys.</param>
/// <param name="options">AES-GCM parameters (nonce / tag / key sizes).</param>
public sealed class EncryptionService(
    IKeyProvider keyProvider,
    Microsoft.Extensions.Options.IOptions<EncryptionOptions> options)
{
    private readonly EncryptionOptions config = options.Value;

    /// <summary>
    ///     Encrypts <paramref name="plaintext" /> with the key identified by
    ///     <paramref name="keyId" />. A fresh nonce is generated for every call.
    /// </summary>
    /// <param name="plaintext">Bytes to encrypt.</param>
    /// <param name="keyId">Target key id.</param>
    /// <param name="cancellationToken">Forwarded to the key provider.</param>
    /// <returns>
    ///     A byte array consisting of <c>nonce ‖ ciphertext ‖ tag</c>.
    ///     Callers persist this blob verbatim; the nonce is required for decryption.
    /// </returns>
    /// <exception cref="InvalidOperationException">Thrown when the resolved key is not 32 bytes.</exception>
    public async Task<byte[]> EncryptAsync(byte[] plaintext, KeyId keyId, CancellationToken cancellationToken = default)
    {
        var key = await keyProvider.GetKeyAsync(keyId, cancellationToken);
        KeyValidator.EnsureKeyLength(key, config.KeySize);

        var nonce = RandomNumberGenerator.GetBytes(config.NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[config.TagSize];

        using var gcm = new AesGcm(key, config.TagSize);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var output = new byte[config.NonceSize + ciphertext.Length + config.TagSize];
        nonce.CopyTo(output.AsSpan(0, config.NonceSize));
        ciphertext.CopyTo(output.AsSpan(config.NonceSize, ciphertext.Length));
        tag.CopyTo(output.AsSpan(config.NonceSize + ciphertext.Length, config.TagSize));
        return output;
    }

    /// <summary>
    ///     Decrypts a payload previously produced by <see cref="EncryptAsync" />.
    /// </summary>
    /// <param name="payload">
    ///     The <c>nonce ‖ ciphertext ‖ tag</c> blob returned from
    ///     <see cref="EncryptAsync" />.
    /// </param>
    /// <param name="keyId">Target key id.</param>
    /// <param name="cancellationToken">Forwarded to the key provider.</param>
    /// <returns>The decrypted plaintext.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="payload" /> is too short to be a valid AES-GCM blob.</exception>
    /// <exception cref="CryptographicException">Thrown when the authentication tag does not verify.</exception>
    public async Task<byte[]> DecryptAsync(byte[] payload, KeyId keyId, CancellationToken cancellationToken = default)
    {
        if (payload.Length < config.NonceSize + config.TagSize)
        {
            throw new ArgumentException(
                "Payload is too short to be a valid AES-GCM blob.",
                nameof(payload));
        }

        var key = await keyProvider.GetKeyAsync(keyId, cancellationToken);
        KeyValidator.EnsureKeyLength(key, config.KeySize);

        var nonce = new byte[config.NonceSize];
        var tag = new byte[config.TagSize];
        var ciphertext = new byte[payload.Length - config.NonceSize - config.TagSize];

        payload.AsSpan(0, config.NonceSize).CopyTo(nonce);
        payload.AsSpan(config.NonceSize, ciphertext.Length).CopyTo(ciphertext);
        payload.AsSpan(config.NonceSize + ciphertext.Length, config.TagSize).CopyTo(tag);

        var plaintext = new byte[ciphertext.Length];
        using var gcm = new AesGcm(key, config.TagSize);
        gcm.Decrypt(nonce, ciphertext, tag, plaintext);
        return plaintext;
    }
}

/// <summary>
///     Validates key material passed to <see cref="EncryptionService" />.
///     File-static so production classes don't carry a private
///     validation method (§1a, <c>code-shape.md</c>).
/// </summary>
internal static class KeyValidator
{
    /// <summary>
    ///     Throws if <paramref name="key" /> is not exactly
    ///     <paramref name="expectedSize" /> bytes long.
    /// </summary>
    /// <param name="key">Key bytes to validate.</param>
    /// <param name="expectedSize">Required length in bytes (e.g. 32 for AES-256).</param>
    /// <exception cref="InvalidOperationException">Thrown when the key is the wrong size.</exception>
    public static void EnsureKeyLength(byte[] key, int expectedSize)
    {
        if (key.Length != expectedSize)
        {
            throw new InvalidOperationException(
                $"AES requires a {expectedSize}-byte key, got {key.Length}.");
        }
    }
}
