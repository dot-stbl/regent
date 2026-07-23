using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Options;
using OsService.Processes;

namespace OsService.Resources;

/// <summary>Per-process resource limits.</summary>
public sealed class ResourceLimits
{
    /// <summary>Maximum CPU shares (Linux only — relative weight).</summary>
    public int? CpuShares { get; set; }

    /// <summary>Memory limit in bytes.</summary>
    public long? MemoryBytes { get; set; }

    /// <summary>Maximum PIDs in the cgroup.</summary>
    public int? PidsMax { get; set; }

    /// <summary>CPU quota in microseconds per <see cref="CpuPeriodMicroseconds"/>.</summary>
    public long? CpuQuotaMicroseconds { get; set; }

    /// <summary>CPU period in microseconds.</summary>
    public long CpuPeriodMicroseconds { get; set; } = 100_000;
}

/// <summary>Result of an enforcement attempt.</summary>
public sealed record EnforcementResult(int ProcessId, bool AppliedLimits, string? ErrorMessage);

/// <summary>
/// Applies per-process resource limits on Linux via cgroups (v2), and on Windows
/// via job objects.
/// </summary>
public sealed class ResourceLimitsEnforcer
{
    private readonly ResourceLimits limits;
    private readonly ILogger<ResourceLimitsEnforcer> logger;
    private readonly string cgroupRoot;

    /// <summary>Constructs the enforcer.</summary>
    public ResourceLimitsEnforcer(
        IOptions<ResourceLimits> limits,
        ILogger<ResourceLimitsEnforcer> logger)
    {
        this.limits = limits.Value;
        this.logger = logger;
        this.cgroupRoot = "/sys/fs/cgroup";
    }

    /// <summary>Applies the configured limits to <paramref name="process"/>.</summary>
    public Task<EnforcementResult> ApplyAsync(Process process, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(process);

        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                return Task.FromResult(ApplyLinux(process));
            }

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return Task.FromResult(ApplyWindows(process));
            }

            return Task.FromResult(new EnforcementResult(process.Id, false, "Unsupported platform."));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to apply resource limits to PID {Pid}", process.Id);
            return Task.FromResult(new EnforcementResult(process.Id, false, ex.Message));
        }
    }

    private EnforcementResult ApplyLinux(Process process)
    {
        var cgroup = Path.Combine(cgroupRoot, $"os-service-{process.Id}");
        Directory.CreateDirectory(cgroup);

        WriteIfNotNull(Path.Combine(cgroup, "cpu.weight"), limits.CpuShares?.ToString());
        WriteIfNotNull(Path.Combine(cgroup, "memory.max"), limits.MemoryBytes?.ToString());
        WriteIfNotNull(Path.Combine(cgroup, "pids.max"), limits.PidsMax?.ToString());

        if (limits.CpuQuotaMicroseconds is { } quota)
        {
            var cpuMax = $"{quota} {limits.CpuPeriodMicroseconds}";
            File.WriteAllText(Path.Combine(cgroup, "cpu.max"), cpuMax);
        }

        // Attach the process to the cgroup.
        File.WriteAllText(Path.Combine(cgroup, "cgroup.procs"), process.Id.ToString());
        logger.LogInformation("Applied cgroup limits to PID {Pid}", process.Id);
        return new EnforcementResult(process.Id, true, null);
    }

    private EnforcementResult ApplyWindows(Process process)
    {
        var handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero)
        {
            return new EnforcementResult(process.Id, false, "CreateJobObject failed.");
        }

        var info = new JOBOBJECT_BASIC_LIMIT_INFORMATION();
        if (limits.MemoryBytes is { } memory)
        {
            info.ProcessMemoryLimit = (nuint)memory;
            info.LimitFlags |= JOBOBJECT_LIMIT_FLAGS.JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        }
        if (limits.CpuShares is { } shares)
        {
            info.CpuRate = (uint)shares;
            info.LimitFlags |= JOBOBJECT_LIMIT_FLAGS.JOB_OBJECT_LIMIT_CPU_RATE_CONTROL;
            info.SchedulingClass = 0;
            info.Weight = (uint)shares;
        }
        if (limits.PidsMax is { } pids)
        {
            info.ActiveProcessLimit = (uint)pids;
            info.LimitFlags |= JOBOBJECT_LIMIT_FLAGS.JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        }

        var extended = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION { BasicLimitInformation = info };
        var length = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var ptr = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(extended, ptr, false);
            if (!SetInformationJobObject(handle, JOBOBJECTINFOCLASS.ExtendedLimitInformation, ptr, (uint)length))
            {
                return new EnforcementResult(process.Id, false, "SetInformationJobObject failed.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }

        if (!AssignProcessToJobObject(handle, process.Handle))
        {
            return new EnforcementResult(process.Id, false, "AssignProcessToJobObject failed.");
        }

        logger.LogInformation("Applied job object limits to PID {Pid}", process.Id);
        return new EnforcementResult(process.Id, true, null);
    }

    private void WriteIfNotNull(string path, string? content)
    {
        if (content is null)
        {
            return;
        }
        File.WriteAllText(path, content);
    }

    private const uint JOB_OBJECT_LIMIT_CPU_RATE_CONTROL = 0x00000040;
    private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, JOBOBJECTINFOCLASS infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    private enum JOBOBJECTINFOCLASS
    {
        ExtendedLimitInformation = 9,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
        public nuint ProcessMemoryLimit;
        public JobObjectExtendedLimitInformationFlags ExtendedLimitFlags;
        public uint CpuRate;
        public uint Weight;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [Flags]
    private enum JobObjectExtendedLimitInformationFlags : uint
    {
        None = 0,
    }

    [Flags]
    private enum JOBOBJECT_LIMIT_FLAGS : uint
    {
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS = JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
        JOB_OBJECT_LIMIT_CPU_RATE_CONTROL = JOB_OBJECT_LIMIT_CPU_RATE_CONTROL,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY = JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }
}
