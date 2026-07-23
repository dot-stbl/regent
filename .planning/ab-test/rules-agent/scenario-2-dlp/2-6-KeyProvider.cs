using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

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
///     Configures the <see cref="KeyProvider" />. Bound from
///     <c>appsettings.json</c> section <c>Dlp:KeyProvider</c>.
/// </summary>
public sealed class KeyProviderOptions
{
    public const string SectionName = "Dlp:KeyProvider";

    /// <summary>
    ///     On-disk path of the key store. Defaults to
    ///     <c>~/.config/dlp/keys.json</c> on Unix and
    ///     <c>%APPDATA%\dlp\keys.json</c> on Windows.
    /// </summary>
    public string StorePath { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".config",
        "dlp",
        "keys.json");

    /// <summary>How often to re-read the on-disk file.</summary>
    public TimeSpan RefreshInterval { get; init; } = TimeSpan.FromMinutes(1);
}

/// <summary>
///     Reads keys from the configured on-disk path with simple in-memory
///     rotation support. Initial load happens at construction; periodic
///     re-load happens when <see cref="Reload" /> is called (typically from
///     a hosted scheduler).
/// </summary>
/// <param name="clock">Wall-clock source.</param>
/// <param name="options">Provider configuration.</param>
public sealed class KeyProvider(
    TimeProvider clock,
    IOptions<KeyProviderOptions> options) : IKeyProvider, IDisposable
{
    /// <summary>Resolved options (reads through the live <see cref="IOptions{TOptions}" />).</summary>
    private KeyProviderOptions Config => options.Value;

    private readonly ReaderWriterLockSlim gate = new();
    private readonly Dictionary<string, ManagedKey> keysById = new(StringComparer.Ordinal);
    private DateTimeOffset lastLoadedAt = DateTimeOffset.MinValue;
    private bool disposed;

    /// <summary>Resolves the on-disk path of the key store.</summary>
    public string StorePath => Config.StorePath;

    /// <summary>Wall-clock instant of the last successful reload.</summary>
    public DateTimeOffset LastLoadedAt => lastLoadedAt;

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

    /// <summary>
    ///     Re-reads the on-disk file. Safe to call from any thread; uses
    ///     a write lock to swap the in-memory dictionary atomically.
    /// </summary>
    public void Reload()
    {
        if (!File.Exists(Config.StorePath))
        {
            return;
        }

        try
        {
            using var stream = File.OpenRead(Config.StorePath);
            var schema = JsonSerializer.Deserialize<KeyStoreSchema>(stream, KeyProviderJsonOptions.Instance);

            if (schema is null)
            {
                return;
            }

            gate.EnterWriteLock();
            try
            {
                keysById.Clear();
                foreach (var key in schema.Keys)
                {
                    keysById[key.Id] = key;
                }
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
