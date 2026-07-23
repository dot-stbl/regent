using System.Diagnostics;
using System.Runtime.InteropServices;

namespace OsService.SystemInfo;

/// <summary>CPU statistics.</summary>
public sealed record CpuStats(double UsagePercent, int LogicalProcessorCount, double LoadAverage1m);

/// <summary>Memory statistics.</summary>
public sealed record MemoryStats(long TotalBytes, long AvailableBytes, long UsedBytes);

/// <summary>Disk usage for a single mount point.</summary>
public sealed record DiskStats(string MountPoint, long TotalBytes, long FreeBytes);

/// <summary>Network interface counters.</summary>
public sealed record NetworkStats(string InterfaceName, long BytesReceived, long BytesSent);

/// <summary>Snapshot of system state at a point in time.</summary>
public sealed record SystemSnapshot(
    DateTimeOffset Timestamp,
    string Hostname,
    CpuStats Cpu,
    MemoryStats Memory,
    IReadOnlyList<DiskStats> Disks,
    IReadOnlyList<NetworkStats> Network);

/// <summary>Collects system information from the host OS.</summary>
public sealed class SystemInfoCollector
{
    private readonly TimeProvider clock;
    private readonly ILogger<SystemInfoCollector> logger;
    private DateTimeOffset previousSampleAt = DateTimeOffset.MinValue;
    private (TimeSpan idle, TimeSpan total) previousCpu = default;

    /// <summary>Constructs the collector.</summary>
    public SystemInfoCollector(TimeProvider clock, ILogger<SystemInfoCollector> logger)
    {
        this.clock = clock;
        this.logger = logger;
    }

    /// <summary>Captures a fresh snapshot of the host.</summary>
    public Task<SystemSnapshot> CollectAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var now = clock.GetUtcNow();
        var cpu = ReadCpu(now);
        var memory = ReadMemory();
        var disks = ReadDisks();
        var network = ReadNetwork();
        var hostname = ReadHostname();

        return Task.FromResult(new SystemSnapshot(now, hostname, cpu, memory, disks, network));
    }

    private CpuStats ReadCpu(DateTimeOffset now)
    {
        var processors = Environment.ProcessorCount;

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            try
            {
                var line = File.ReadAllText("/proc/stat").Split('\n')[0];
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                long user = long.Parse(parts[1]);
                long nice = long.Parse(parts[2]);
                long system = long.Parse(parts[3]);
                long idle = long.Parse(parts[4]);
                var total = user + nice + system + idle;
                var currentIdle = TimeSpan.FromTicks(idle);
                var currentTotal = TimeSpan.FromTicks(total);

                double usagePercent = 0;
                if (previousSampleAt != DateTimeOffset.MinValue)
                {
                    var totalDelta = (currentTotal - previousCpu.total).TotalMilliseconds;
                    var idleDelta = (currentIdle - previousCpu.idle).TotalMilliseconds;
                    usagePercent = totalDelta <= 0 ? 0 : Math.Clamp(100.0 * (1.0 - idleDelta / totalDelta), 0, 100);
                }

                previousCpu = (currentIdle, currentTotal);
                previousSampleAt = now;

                var loadAverage = ReadLoadAverage();
                return new CpuStats(usagePercent, processors, loadAverage);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to read /proc/stat");
            }
        }

        return new CpuStats(0, processors, 0);
    }

    private static double ReadLoadAverage()
    {
        try
        {
            var first = File.ReadAllText("/proc/loadavg").Split(' ')[0];
            return double.Parse(first, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static MemoryStats ReadMemory()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            try
            {
                long total = 0, available = 0;
                foreach (var line in File.ReadAllLines("/proc/meminfo"))
                {
                    if (line.StartsWith("MemTotal:", StringComparison.Ordinal))
                    {
                        total = ParseKilobytes(line);
                    }
                    else if (line.StartsWith("MemAvailable:", StringComparison.Ordinal))
                    {
                        available = ParseKilobytes(line);
                    }
                }

                var used = total - available;
                return new MemoryStats(total * 1024, available * 1024, used * 1024);
            }
            catch
            {
            }
        }

        var gcm = GC.GetGCMemoryInfo();
        return new MemoryStats(gcm.TotalAvailableMemoryBytes, 0, 0);
    }

    private static long ParseKilobytes(string line)
    {
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return long.TryParse(parts[1], out var kb) ? kb : 0;
    }

    private static IReadOnlyList<DiskStats> ReadDisks()
    {
        var result = new List<DiskStats>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (!drive.IsReady)
            {
                continue;
            }

            try
            {
                result.Add(new DiskStats(drive.Name, drive.TotalSize, drive.AvailableFreeSpace));
            }
            catch
            {
            }
        }
        return result;
    }

    private static IReadOnlyList<NetworkStats> ReadNetwork()
    {
        var result = new List<NetworkStats>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            var stats = nic.GetIPv4Statistics();
            result.Add(new NetworkStats(nic.Name, stats.BytesReceived, stats.BytesSent));
        }
        return result;
    }

    private static string ReadHostname()
    {
        try
        {
            return Environment.MachineName;
        }
        catch
        {
            return "unknown";
        }
    }
}
