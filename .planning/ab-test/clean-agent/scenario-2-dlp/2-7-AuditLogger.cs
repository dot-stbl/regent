using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dlp.Audit;

/// <summary>
/// A single audit record.
/// </summary>
public sealed record AuditEntry(
    DateTimeOffset Timestamp,
    string Actor,
    string Action,
    string Target,
    string Outcome,
    IReadOnlyDictionary<string, string>? Metadata);

/// <summary>
/// Append-only JSON-lines audit log. Each entry is written to a daily file
/// <c>audit-YYYY-MM-DD.log</c> in the configured directory.
/// </summary>
public sealed class AuditLogger : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    private readonly string directory;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private string? currentFile;
    private bool disposed;

    /// <summary>Constructs the logger.</summary>
    /// <param name="directory">Directory where daily log files are created.</param>
    /// <param name="clock">Time source.</param>
    public AuditLogger(string directory, TimeProvider clock)
    {
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new ArgumentException("Directory must be provided.", nameof(directory));
        }

        this.directory = directory;
        this.clock = clock;
        Directory.CreateDirectory(directory);
    }

    /// <summary>Appends a single entry to today's log file.</summary>
    public async Task AppendAsync(AuditEntry entry, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ct.ThrowIfCancellationRequested();

        var path = ResolveFilePath();
        var json = JsonSerializer.Serialize(entry, JsonOptions);

        await writeLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var stream = new FileStream(
                path,
                FileMode.Append,
                FileAccess.Write,
                FileShare.Read,
                bufferSize: 4096,
                useAsync: true);
            var bytes = System.Text.Encoding.UTF8.GetBytes(json + Environment.NewLine);
            await stream.WriteAsync(bytes.AsMemory(0, bytes.Length), ct).ConfigureAwait(false);
        }
        finally
        {
            writeLock.Release();
        }
    }

    private string ResolveFilePath()
    {
        var today = clock.GetUtcNow().ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var path = Path.Combine(directory, $"audit-{today}.log");
        if (!string.Equals(path, currentFile, StringComparison.Ordinal))
        {
            currentFile = path;
        }
        return path;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        writeLock.Dispose();
        GC.SuppressFinalize(this);
    }
}
