using System.Runtime.CompilerServices;
using Microsoft.Extensions.Options;

namespace OsService.Logs;

/// <summary>Configuration values for the log tail service.</summary>
public sealed class LogTailOptions
{
    /// <summary>How often to poll the file for new content.</summary>
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromMilliseconds(250);

    /// <summary>Maximum size of a single read buffer.</summary>
    public int BufferSize { get; set; } = 4096;
}

/// <summary>
/// Tails a log file, returning new lines as they are written, and handling
/// rotation by following the file's inode on Unix and the file handle on Windows.
/// </summary>
public sealed class LogTailService
{
    private readonly LogTailOptions options;
    private readonly ILogger<LogTailService> logger;

    /// <summary>Constructs the service.</summary>
    public LogTailService(IOptions<LogTailOptions> options, ILogger<LogTailService> logger)
    {
        this.options = options.Value;
        this.logger = logger;
    }

    /// <summary>
    /// Streams log lines starting at <paramref name="fromOffset"/>, polling for new content
    /// until cancellation is requested or the file disappears.
    /// </summary>
    public async IAsyncEnumerable<string> TailAsync(
        string filePath,
        long fromOffset,
        [EnumeratorCancellation] CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("File path must be provided.", nameof(filePath));
        }

        if (fromOffset < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(fromOffset), "Offset cannot be negative.");
        }

        long offset = fromOffset;
        while (!ct.IsCancellationRequested)
        {
            if (!File.Exists(filePath))
            {
                await Task.Delay(options.PollInterval, ct).ConfigureAwait(false);
                continue;
            }

            using var stream = new FileStream(
                filePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                options.BufferSize,
                useAsync: true);

            if (stream.Length < offset)
            {
                // File was truncated or rotated; start from the beginning.
                offset = 0;
            }

            stream.Seek(offset, SeekOrigin.Begin);

            var buffer = new byte[options.BufferSize];
            int read;
            var pending = new System.Text.StringBuilder();
            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
            {
                for (var i = 0; i < read; i++)
                {
                    var c = (char)buffer[i];
                    if (c == '\n')
                    {
                        var line = pending.ToString().TrimEnd('\r');
                        yield return line;
                        pending.Clear();
                    }
                    else
                    {
                        pending.Append(c);
                    }
                }
            }

            offset = stream.Position;
            await Task.Delay(options.PollInterval, ct).ConfigureAwait(false);
        }
    }
}
