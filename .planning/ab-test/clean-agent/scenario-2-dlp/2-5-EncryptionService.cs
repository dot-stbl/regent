using System.Security.Cryptography;
using Dlp.Keys;

namespace Dlp.Keys;

/// <summary>
/// Opaque identifier for a key managed by the key provider.
/// </summary>
public readonly record struct KeyId(string Value)
{
    /// <inheritdoc />
    public override string ToString() => Value;
}

/// <summary>
/// Provides a 256-bit AES key for the requested <see cref="KeyId"/>.
/// </summary>
public interface IKeyProvider
{
    /// <summary>Returns the symmetric key bytes for <paramref name="keyId"/>.</summary>
    Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken ct);
}

/// <summary>
/// Encrypts and decrypts payloads with AES-GCM using a key fetched from the provider.
/// </summary>
public sealed class EncryptionService
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly IKeyProvider keyProvider;

    /// <summary>Constructs the service.</summary>
    public EncryptionService(IKeyProvider keyProvider)
    {
        this.keyProvider = keyProvider;
    }

    /// <summary>Encrypts <paramref name="plaintext"/> with the key identified by <paramref name="keyId"/>.</summary>
    /// <returns>
    /// A byte array consisting of <c>nonce || ciphertext || tag</c>. The nonce is freshly
    /// generated on every call.
    /// </returns>
    public async Task<byte[]> EncryptAsync(byte[] plaintext, KeyId keyId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(plaintext);

        var key = await keyProvider.GetKeyAsync(keyId, ct).ConfigureAwait(false);
        if (key.Length != 32)
        {
            throw new InvalidOperationException("AES-256 requires a 32-byte key.");
        }

        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var output = new byte[NonceSize + ciphertext.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, output, 0, NonceSize);
        Buffer.BlockCopy(ciphertext, 0, output, NonceSize, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, output, NonceSize + ciphertext.Length, TagSize);
        return output;
    }

    /// <summary>Decrypts a payload previously produced by <see cref="EncryptAsync"/>.</summary>
    public async Task<byte[]> DecryptAsync(byte[] payload, KeyId keyId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (payload.Length < NonceSize + TagSize)
        {
            throw new ArgumentException("Payload is too short to be a valid AES-GCM blob.", nameof(payload));
        }

        var key = await keyProvider.GetKeyAsync(keyId, ct).ConfigureAwait(false);
        if (key.Length != 32)
        {
            throw new InvalidOperationException("AES-256 requires a 32-byte key.");
        }

        var nonce = new byte[NonceSize];
        var tag = new byte[TagSize];
        var ciphertext = new byte[payload.Length - NonceSize - TagSize];

        Buffer.BlockCopy(payload, 0, nonce, 0, NonceSize);
        Buffer.BlockCopy(payload, NonceSize, ciphertext, 0, ciphertext.Length);
        Buffer.BlockCopy(payload, NonceSize + ciphertext.Length, tag, 0, TagSize);

        var plaintext = new byte[ciphertext.Length];
        using var gcm = new AesGcm(key, TagSize);
        gcm.Decrypt(nonce, ciphertext, tag, plaintext);
        return plaintext;
    }
}
