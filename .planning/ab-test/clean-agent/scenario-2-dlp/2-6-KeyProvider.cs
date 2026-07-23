using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dlp.Keys;

/// <summary>
/// Plain-text record stored on disk for each managed key.
/// </summary>
public sealed class ManagedKey
{
    /// <summary>Stable identifier of the key.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Base64-encoded 256-bit secret.</summary>
    public string Material { get; set; } = string.Empty;

    /// <summary>Wall-clock instant when the key was created.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Wall-clock instant after which the key must not be used for new encryptions.</summary>
    public DateTimeOffset? RetiredAt { get; set; }
}

/// <summary>
/// On-disk schema for <c>keys.json</c>.
/// </summary>
public sealed class KeyStoreSchema
{
    /// <summary>All managed keys.</summary>
    public List<ManagedKey> Keys { get; set; } = new();
}

/// <summary>
/// Reads keys from <c>~/.config/dlp/keys.json</c> with simple in-memory rotation support.
/// </summary>
public sealed class KeyProvider : IKeyProvider, IDisposable
{
    private readonly string storePath;
    private readonly TimeProvider clock;
    private readonly TimeSpan refreshInterval;
    private readonly ReaderWriterLockSlim gate = new();
    private readonly IDisposable? refreshTimer;
    private Dictionary<string, ManagedKey> keysById = new(StringComparer.Ordinal);
    private DateTimeOffset lastLoadedAt = DateTimeOffset.MinValue;
    private bool disposed;

    /// <summary>Constructs the provider, loading keys immediately and on a refresh timer.</summary>
    public KeyProvider(TimeProvider clock, string? overridePath = null, TimeSpan? refreshInterval = null)
    {
        this.clock = clock;
        this.refreshInterval = refreshInterval ?? TimeSpan.FromMinutes(1);
        this.storePath = overridePath ?? DefaultStorePath();

        Reload();
        refreshTimer = clock.CreateTimer(_ => Reload(), null, this.refreshInterval, this.refreshInterval);
    }

    /// <inheritdoc />
    public Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        gate.EnterReadLock();
        try
        {
            if (!keysById.TryGetValue(keyId.Value, out var entry))
            {
                throw new KeyNotFoundException($"No key with id '{keyId.Value}' is loaded.");
            }

            if (entry.RetiredAt is { } retired && retired <= clock.GetUtcNow())
            {
                throw new KeyNotFoundException($"Key '{keyId.Value}' has been retired.");
            }

            return Task.FromResult(Convert.FromBase64String(entry.Material));
        }
        finally
        {
            gate.ExitReadLock();
        }
    }

    /// <summary>Returns the resolved on-disk path of the key store.</summary>
    public string StorePath => storePath;

    private static string DefaultStorePath()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(home, ".config", "dlp", "keys.json");
    }

    private void Reload()
    {
        try
        {
            if (!File.Exists(storePath))
            {
                return;
            }

            using var stream = File.OpenRead(storePath);
            var schema = JsonSerializer.Deserialize<KeyStoreSchema>(
                stream,
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    Converters = { new JsonStringEnumConverter() }
                });

            if (schema is null)
            {
                return;
            }

            gate.EnterWriteLock();
            try
            {
                keysById = schema.Keys.ToDictionary(k => k.Id, StringComparer.Ordinal);
                lastLoadedAt = clock.GetUtcNow();
            }
            finally
            {
                gate.ExitWriteLock();
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallow IO/parse errors so a corrupted file does not crash the host.
            // Callers will surface a KeyNotFoundException on the next GetKeyAsync.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        refreshTimer?.Dispose();
        gate.Dispose();
        GC.SuppressFinalize(this);
    }
}
