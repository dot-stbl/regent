using Dlp.Scanning;
using Microsoft.Extensions.Hosting;

namespace Dlp.Scanning;

/// <summary>Index of file hash → metadata, written by the scanner.</summary>
public interface IFileHashIndex
{
    /// <summary>Adds an entry to the index.</summary>
    Task IndexAsync(FileScanResult result, CancellationToken ct);
}

/// <summary>Source of paths the worker should scan on each pass.</summary>
public interface IScannerWatchlist
{
    /// <summary>Returns the list of paths to scan on the current pass.</summary>
    Task<IReadOnlyList<string>> GetPathsAsync(CancellationToken ct);
}

/// <summary>
/// Background service that runs the <see cref="FileScanner"/> over each watched
/// directory on a periodic schedule and pushes results into the hash index.
/// </summary>
public sealed class ScannerWorker : BackgroundService
{
    private static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(15);

    private readonly IServiceScopeFactory scopeFactory;
    private readonly ILogger<ScannerWorker> logger;

    /// <summary>Constructs the worker.</summary>
    public ScannerWorker(IServiceScopeFactory scopeFactory, ILogger<ScannerWorker> logger)
    {
        this.scopeFactory = scopeFactory;
        this.logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ScanOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Scan pass failed");
            }

            try
            {
                await Task.Delay(ScanInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task ScanOnceAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var watchlist = scope.ServiceProvider.GetRequiredService<IScannerWatchlist>();
        var index = scope.ServiceProvider.GetRequiredService<IFileHashIndex>();

        using var scanner = new FileScanner();
        var paths = await watchlist.GetPathsAsync(ct).ConfigureAwait(false);

        var totalFiles = 0;
        var totalBytes = 0L;
        foreach (var path in paths)
        {
            await foreach (var result in scanner.ScanAsync(path, ct).ConfigureAwait(false))
            {
                await index.IndexAsync(result, ct).ConfigureAwait(false);
                totalFiles++;
                totalBytes += result.SizeBytes;
            }
        }

        logger.LogInformation(
            "Scan pass complete: {FileCount} files, {TotalBytes} bytes across {PathCount} paths",
            totalFiles, totalBytes, paths.Count);
    }
}
