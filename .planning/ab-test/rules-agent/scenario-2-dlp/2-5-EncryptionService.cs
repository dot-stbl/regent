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
    Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken cancellationToken = default);
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
///     Encrypts and decrypts payloads with AES-GCM using a key fetched from
///     the provider. Output format: <c>nonce ‖ ciphertext ‖ tag</c>.
/// </summary>
/// <param name="keyProvider">Source of 256-bit symmetric keys.</param>
public sealed class EncryptionService(IKeyProvider keyProvider)
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;

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
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="plaintext" /> is null.</exception>
    /// <exception cref="InvalidOperationException">Thrown when the resolved key is not 32 bytes.</exception>
    public async Task<byte[]> EncryptAsync(byte[] plaintext, KeyId keyId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plaintext);

        var key = await keyProvider.GetKeyAsync(keyId, cancellationToken);
        EnsureKeyLength(key);

        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var output = new byte[NonceSize + ciphertext.Length + TagSize];
        nonce.CopyTo(output.AsSpan(0, NonceSize));
        ciphertext.CopyTo(output.AsSpan(NonceSize, ciphertext.Length));
        tag.CopyTo(output.AsSpan(NonceSize + ciphertext.Length, TagSize));
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
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="payload" /> is null.</exception>
    /// <exception cref="ArgumentException">Thrown when <paramref name="payload" /> is too short to be a valid AES-GCM blob.</exception>
    /// <exception cref="CryptographicException">Thrown when the authentication tag does not verify.</exception>
    public async Task<byte[]> DecryptAsync(byte[] payload, KeyId keyId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (payload.Length < NonceSize + TagSize)
        {
            throw new ArgumentException(
                "Payload is too short to be a valid AES-GCM blob.",
                nameof(payload));
        }

        var key = await keyProvider.GetKeyAsync(keyId, cancellationToken);
        EnsureKeyLength(key);

        var nonce = new byte[NonceSize];
        var tag = new byte[TagSize];
        var ciphertext = new byte[payload.Length - NonceSize - TagSize];

        payload.AsSpan(0, NonceSize).CopyTo(nonce);
        payload.AsSpan(NonceSize, ciphertext.Length).CopyTo(ciphertext);
        payload.AsSpan(NonceSize + ciphertext.Length, TagSize).CopyTo(tag);

        var plaintext = new byte[ciphertext.Length];
        using var gcm = new AesGcm(key, TagSize);
        gcm.Decrypt(nonce, ciphertext, tag, plaintext);
        return plaintext;
    }

    private static void EnsureKeyLength(byte[] key)
    {
        if (key.Length != KeySize)
        {
            throw new InvalidOperationException($"AES-256 requires a {KeySize}-byte key, got {key.Length}.");
        }
    }
}
