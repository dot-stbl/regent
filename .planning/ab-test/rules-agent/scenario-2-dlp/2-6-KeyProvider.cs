using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dlp.Keys;

/// <summary>
///     Plain-text record stored on disk for each managed key. Init-only
///     properties so a deserialized instance is immutable.
/// </summary>
/// <param name="Id">Stable identifier of the key.</param>
/// <param name="Material">Base64-encoded 256-bit secret.</param>
/// <param name="CreatedAt">Wall-clock instant when the key was created.</param>
/// <param name="RetiredAt">Wall-clock instant after which the key must not be used for new encryptions.</param>
public sealed record ManagedKey(
    string Id,
    string Material,
    DateTimeOffset CreatedAt,
    DateTimeOffset? RetiredAt);

/// <summary>
///     On-disk schema for <c>keys.json</c>.
/// </summary>
/// <param name="Keys">All managed keys.</param>
public sealed record KeyStoreSchema(IReadOnlyCollection<ManagedKey> Keys);

/// <summary>
///     Reads keys from <c>~/.config/dlp/keys.json</c> with simple in-memory
///     rotation support. Refreshes on a <see cref="TimeProvider" />-driven timer.
/// </summary>
public sealed class KeyProvider : IKeyProvider, IDisposable
{
    private const string FileName = "keys.json";

    private readonly TimeProvider clock;
    private readonly string storePath;
    private readonly TimeSpan refreshInterval;
    private readonly ReaderWriterLockSlim gate = new();
    private readonly IDisposable? refreshTimer;

    private Dictionary<string, ManagedKey> keysById = new(StringComparer.Ordinal);
    private DateTimeOffset lastLoadedAt = DateTimeOffset.MinValue;
    private bool disposed;

    /// <summary>
    ///     Constructs the provider, loading keys immediately and on a refresh timer.
    /// </summary>
    /// <param name="clock">Wall-clock source.</param>
    /// <param name="overridePath">Override for the on-disk key store path (test-only).</param>
    /// <param name="refreshInterval">How often to re-read the on-disk file.</param>
    public KeyProvider(TimeProvider clock, string? overridePath = null, TimeSpan? refreshInterval = null)
    {
        this.clock = clock;
        this.refreshInterval = refreshInterval ?? TimeSpan.FromMinutes(1);
        this.storePath = overridePath ?? DefaultStorePath();

        Reload();
        refreshTimer = clock.CreateTimer(_ => Reload(), null, this.refreshInterval, this.refreshInterval);
    }

    /// <inheritdoc />
    public Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        gate.EnterReadLock();
        try
        {
            if (!keysById.TryGetValue(keyId.Value, out var entry))
            {
                throw new KeyNotFoundException(keyId);
            }

            if (entry.RetiredAt is { } retired && retired <= clock.GetUtcNow())
            {
                throw new KeyRetiredException(keyId, retired);
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
        return Path.Combine(home, ".config", "dlp", FileName);
    }

    private void Reload()
    {
        if (!File.Exists(storePath))
        {
            return;
        }

        try
        {
            using var stream = File.OpenRead(storePath);
            var schema = JsonSerializer.Deserialize<KeyStoreSchema>(stream, KeyProviderJsonOptions.Instance);

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

/// <summary>
///     Shared <see cref="JsonSerializerOptions" /> for the on-disk key schema.
///     Used by both <see cref="KeyProvider" /> and any writer (key creation,
///     rotation). Case-insensitive to support human-edited files; enums as
///     strings for readability.
/// </summary>
internal static class KeyProviderJsonOptions
{
    public static JsonSerializerOptions Instance { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };
}
