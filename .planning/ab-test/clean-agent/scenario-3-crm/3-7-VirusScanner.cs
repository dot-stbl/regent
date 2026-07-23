using System.Net;
using System.Net.Sockets;
using System.Text;
using Crm.Documents;

namespace Crm.Documents;

/// <summary>
/// Settings used to connect to the ClamAV daemon.
/// </summary>
public sealed class ClamAvOptions
{
    /// <summary>Host running clamd.</summary>
    public string Host { get; set; } = "localhost";

    /// <summary>Port the daemon is listening on.</summary>
    public int Port { get; set; } = 3310;

    /// <summary>Timeout for a single scan call.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>
/// Minimal Refit-shaped abstraction over the ClamAV client. The interface is kept
/// inline so this chunk remains self-contained.
/// </summary>
public interface IClamAvClient
{
    /// <summary>Sends the INSTREAM command followed by the bytes of the document.</summary>
    Task<string> ScanStreamAsync(Stream content, CancellationToken ct);
}

/// <summary>
/// Wraps the ClamAV daemon (clamd) and translates its textual response into a
/// strongly-typed <see cref="ScanResult"/>.
/// </summary>
public sealed class VirusScanner : IVirusScanner
{
    private readonly IClamAvClient client;
    private readonly ILogger<VirusScanner> logger;

    /// <summary>Constructs the scanner with an injected Refit client.</summary>
    public VirusScanner(IClient client, ILogger<VirusScanner> logger)
    {
        // We type the parameter as the inline interface so the chunk remains
        // self-contained, but at runtime IClient is the Refit-generated proxy.
        this.client = client;
        this.logger = logger;
    }

    /// <summary>Constructs the scanner with a plain IClamAvClient (test seam).</summary>
    public VirusScanner(IClient client) : this(client, NullLogger<VirusScanner>.Instance)
    {
    }

    /// <inheritdoc />
    public async Task<ScanResult> ScanAsync(Stream content, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);

        try
        {
            var response = await client.ScanStreamAsync(content, ct).ConfigureAwait(false);
            return Parse(response);
        }
        catch (Exception ex) when (ex is IOException or SocketException)
        {
            logger.LogError(ex, "ClamAV transport failure");
            return new ScanResult(ScanVerdict.Error, ex.Message);
        }
    }

    private static ScanResult Parse(string response)
    {
        // clamd replies: "stream: OK" or "stream: <name> FOUND"
        if (string.IsNullOrWhiteSpace(response))
        {
            return new ScanResult(ScanVerdict.Error, "empty response from clamd");
        }

        var trimmed = response.Trim();
        if (trimmed.EndsWith("OK", StringComparison.Ordinal))
        {
            return new ScanResult(ScanVerdict.Clean, null);
        }

        if (trimmed.Contains("FOUND", StringComparison.OrdinalIgnoreCase))
        {
            var idx = trimmed.IndexOf(':');
            var threat = idx >= 0 ? trimmed[(idx + 1)..].Trim().Replace(" FOUND", string.Empty, StringComparison.OrdinalIgnoreCase).Trim() : trimmed;
            return new ScanResult(ScanVerdict.Infected, threat);
        }

        return new ScanResult(ScanVerdict.Error, trimmed);
    }
}

/// <summary>
/// Default no-op logger used when the chunk is consumed without DI.
/// </summary>
public sealed class NullLogger<T> : ILogger<T>
{
    /// <summary>Singleton instance.</summary>
    public static readonly NullLogger<T> Instance = new();

    private NullLogger()
    {
    }

    /// <inheritdoc />
    public IDisposable BeginScope<TState>(TState state) where TState : notnull => new Scope();

    /// <inheritdoc />
    public bool IsEnabled(LogLevel logLevel) => false;

    /// <inheritdoc />
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
    }

    private sealed class Scope : IDisposable
    {
        public void Dispose()
        {
        }
    }
}
