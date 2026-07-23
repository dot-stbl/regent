using System.Diagnostics;
using System.Text;

namespace OsService.Processes;

/// <summary>Options that influence how a child process is spawned.</summary>
public sealed record ProcessSpawnOptions
{
    /// <summary>Working directory for the child process.</summary>
    public string? WorkingDirectory { get; init; }

    /// <summary>Environment variables to add or override.</summary>
    public IReadOnlyDictionary<string, string>? Environment { get; init; }

    /// <summary>Optional stdin payload.</summary>
    public ReadOnlyMemory<byte> StandardInput { get; init; }

    /// <summary>Maximum time to wait for the process to exit.</summary>
    public TimeSpan? Timeout { get; init; }

    /// <summary>If <see langword="true"/>, the child's stdout is captured to a buffer.</summary>
    public bool CaptureStdout { get; init; } = true;

    /// <summary>If <see langword="true"/>, the child's stderr is captured to a buffer.</summary>
    public bool CaptureStderr { get; init; } = true;
}

/// <summary>Result of running a process.</summary>
/// <param name="ExitCode">Exit code of the child process.</param>
/// <param name="Stdout">Captured stdout (may be empty when not captured).</param>
/// <param name="Stderr">Captured stderr (may be empty when not captured).</param>
/// <param name="Elapsed">Wall-clock duration of the run.</param>
public sealed record ProcessRunResult(int ExitCode, string Stdout, string Stderr, TimeSpan Elapsed);

/// <summary>Thin wrapper around <see cref="System.Diagnostics.Process"/>.</summary>
public sealed class ProcessSpawner
{
    private readonly TimeProvider clock;
    private readonly ILogger<ProcessSpawner> logger;

    /// <summary>Constructs the spawner with a clock and logger.</summary>
    public ProcessSpawner(TimeProvider clock, ILogger<ProcessSpawner> logger)
    {
        this.clock = clock;
        this.logger = logger;
    }

    /// <summary>Runs <paramref name="executable"/> with the supplied arguments.</summary>
    public async Task<ProcessRunResult> RunAsync(
        string executable,
        IReadOnlyList<string> args,
        ProcessSpawnOptions options,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(executable))
        {
            throw new ArgumentException("Executable must be provided.", nameof(executable));
        }

        ArgumentNullException.ThrowIfNull(options);

        var psi = new ProcessStartInfo
        {
            FileName = executable,
            RedirectStandardOutput = options.CaptureStdout,
            RedirectStandardError = options.CaptureStderr,
            RedirectStandardInput = !options.StandardInput.IsEmpty,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = options.WorkingDirectory ?? string.Empty,
        };

        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        if (options.Environment is not null)
        {
            foreach (var (key, value) in options.Environment)
            {
                psi.Environment[key] = value;
            }
        }

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        if (options.CaptureStdout)
        {
            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is not null)
                {
                    stdout.AppendLine(e.Data);
                }
            };
        }

        if (options.CaptureStderr)
        {
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is not null)
                {
                    stderr.AppendLine(e.Data);
                }
            };
        }

        var startedAt = clock.GetTimestamp();
        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start '{executable}'.");
        }

        if (options.CaptureStdout)
        {
            process.BeginOutputReadLine();
        }

        if (options.CaptureStderr)
        {
            process.BeginErrorReadLine();
        }

        if (!options.StandardInput.IsEmpty)
        {
            await process.StandardInput.BaseStream.WriteAsync(options.StandardInput, ct).ConfigureAwait(false);
            process.StandardInput.Close();
        }

        using var timeoutCts = options.Timeout is { } t ? new CancellationTokenSource(t) : null;
        using var linked = timeoutCts is null
            ? null
            : CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        var token = linked?.Token ?? ct;
        try
        {
            await process.WaitForExitAsync(token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (timeoutCts is not null && timeoutCts.IsCancellationRequested)
        {
            TryKill(process);
            logger.LogWarning("Process {Executable} timed out after {Timeout}", executable, options.Timeout);
            throw new TimeoutException($"Process '{executable}' exceeded timeout of {options.Timeout}.");
        }

        var elapsed = clock.GetElapsedTime(startedAt);
        return new ProcessRunResult(process.ExitCode, stdout.ToString(), stderr.ToString(), elapsed);
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // best-effort
        }
    }
}
