using System.Buffers;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;

namespace Dlp.Scanning;

/// <summary>
/// Outcome of scanning a single file.
/// </summary>
/// <param name="Path">Path of the file on disk.</param>
/// <param name="SizeBytes">File size in bytes.</param>
/// <param name="Sha256">Lower-case hex SHA-256 of the file content.</param>
public sealed record FileScanResult(string Path, long SizeBytes, string Sha256);

/// <summary>
/// Recursively walks a directory tree, computing SHA-256 hashes of each file.
/// </summary>
public sealed class FileScanner : IDisposable
{
    private static readonly EnumerationOptions EnumerationOptions = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        ReturnSpecialDirectories = false,
        AttributesToSkip = FileAttributes.ReparsePoint,
    };

    private readonly ArrayPool<byte> bufferPool = ArrayPool<byte>.Shared;
    private bool disposed;

    /// <summary>
    /// Streams scan results for the directory tree rooted at <paramref name="root"/>.
    /// </summary>
    /// <param name="root">Directory to scan.</param>
    /// <param name="ct">Token to cancel the operation.</param>
    public async IAsyncEnumerable<FileScanResult> ScanAsync(
        string root,
        [EnumeratorCancellation] CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(root))
        {
            throw new ArgumentException("Root directory must be provided.", nameof(root));
        }

        if (!Directory.Exists(root))
        {
            throw new DirectoryNotFoundException($"Directory not found: {root}");
        }

        foreach (var path in Directory.EnumerateFiles(root, "*", EnumerationOptions))
        {
            ct.ThrowIfCancellationRequested();
            FileScanResult? result = null;
            try
            {
                result = await HashFileAsync(path, ct).ConfigureAwait(false);
            }
            catch (IOException ex)
            {
                throw new IOException($"Failed to read '{path}'.", ex);
            }
            catch (UnauthorizedAccessException ex)
            {
                throw new UnauthorizedAccessException($"Access denied to '{path}'.", ex);
            }

            if (result is not null)
            {
                yield return result;
            }
        }
    }

    /// <summary>Computes the SHA-256 hash of a single file.</summary>
    private async Task<FileScanResult> HashFileAsync(string path, CancellationToken ct)
    {
        var info = new FileInfo(path);
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            useAsync: true);

        using var sha = SHA256.Create();
        var buffer = bufferPool.Rent(81920);
        try
        {
            int read;
            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
            {
                sha.TransformBlock(buffer, 0, read, null, 0);
            }
            sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        }
        finally
        {
            bufferPool.Return(buffer);
        }

        return new FileScanResult(path, info.Length, Convert.ToHexString(sha.Hash!).ToLowerInvariant());
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        GC.SuppressFinalize(this);
    }
}
