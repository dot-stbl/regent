using System.Threading.Channels;
using Microsoft.Extensions.Hosting;

namespace OsService.FileSystem;

/// <summary>Kind of change reported by the watcher.</summary>
public enum FileChangeKind
{
    Created = 0,
    Updated = 1,
    Renamed = 2,
    Deleted = 3,
}

/// <summary>A single change notification.</summary>
public sealed record FileChangedEvent(string Path, FileChangeKind Kind, DateTimeOffset Timestamp);

/// <summary>Hosted service that wraps <see cref="System.IO.FileSystemWatcher"/> and
/// emits debounced notifications to a bounded <see cref="Channel{T}"/>.</summary>
public sealed class FileSystemWatcherService : IHostedService, IDisposable
{
    private readonly Channel<FileChangedEvent> channel;
    private readonly TimeSpan debounce;
    private readonly ILogger<FileSystemWatcherService> logger;
    private FileSystemWatcher? watcher;
    private readonly Dictionary<string, DateTimeOffset> lastEventPerPath = new(StringComparer.Ordinal);
    private readonly object debounceLock = new();
    private CancellationTokenSource? debounceCts;
    private Task? debounceLoop;
    private bool disposed;

    /// <summary>Constructs the service.</summary>
    public FileSystemWatcherService(
        Channel<FileChangedEvent> channel,
        TimeSpan? debounce = null,
        ILogger<FileSystemWatcherService>? logger = null)
    {
        this.channel = channel;
        this.debounce = debounce ?? TimeSpan.FromMilliseconds(250);
        this.logger = logger ?? NullLogger<FileSystemWatcherService>.Instance;
    }

    /// <summary>Reader side of the channel.</summary>
    public ChannelReader<FileChangedEvent> Reader => channel.Reader;

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        throw new NotImplementedException("Use the overload that takes a directory path and filter.");
    }

    /// <summary>Starts watching <paramref name="directory"/> for changes to files matching <paramref name="filter"/>.</summary>
    public Task StartAsync(string directory, string filter, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new ArgumentException("Directory must be provided.", nameof(directory));
        }

        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException($"Directory not found: {directory}");
        }

        watcher = new FileSystemWatcher(directory, filter)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName
                | NotifyFilters.LastWrite
                | NotifyFilters.Size
                | NotifyFilters.CreationTime,
            InternalBufferSize = 64 * 1024,
        };

        watcher.Created += (_, e) => OnChanged(e.FullPath, FileChangeKind.Created);
        watcher.Changed += (_, e) => OnChanged(e.FullPath, FileChangeKind.Updated);
        watcher.Renamed += (_, e) => OnChanged(e.FullPath, FileChangeKind.Renamed);
        watcher.Deleted += (_, e) => OnChanged(e.FullPath, FileChangeKind.Deleted);
        watcher.Error += (_, e) => logger.LogError(e.GetException(), "FileSystemWatcher error");

        debounceCts = new CancellationTokenSource();
        debounceLoop = Task.Run(() => DebounceLoopAsync(debounceCts.Token), cancellationToken);

        watcher.EnableRaisingEvents = true;
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (watcher is not null)
        {
            watcher.EnableRaisingEvents = false;
        }

        debounceCts?.Cancel();
        if (debounceLoop is not null)
        {
            try
            {
                await debounceLoop.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }

        channel.Writer.TryComplete();
    }

    private void OnChanged(string path, FileChangeKind kind)
    {
        lock (debounceLock)
        {
            lastEventPerPath[path] = DateTimeOffset.UtcNow;
        }
    }

    private async Task DebounceLoopAsync(CancellationToken ct)
    {
        var lastSweep = DateTimeOffset.UtcNow;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(debounce, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            var now = DateTimeOffset.UtcNow;
            var toEmit = new List<FileChangedEvent>();

            lock (debounceLock)
            {
                foreach (var (path, ts) in lastEventPerPath)
                {
                    if (now - ts >= debounce)
                    {
                        toEmit.Add(new FileChangedEvent(path, FileChangeKind.Updated, ts));
                    }
                }

                foreach (var ev in toEmit)
                {
                    lastEventPerPath.Remove(ev.Path);
                }
            }

            foreach (var ev in toEmit)
            {
                await channel.Writer.WriteAsync(ev, ct).ConfigureAwait(false);
            }

            lastSweep = now;
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
        watcher?.Dispose();
        debounceCts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private sealed class NullLogger<T> : ILogger<T>
    {
        public static readonly NullLogger<T> Instance = new();

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => new Scope();
        public bool IsEnabled(LogLevel logLevel) => false;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) { }

        private sealed class Scope : IDisposable
        {
            public void Dispose() { }
        }
    }
}
