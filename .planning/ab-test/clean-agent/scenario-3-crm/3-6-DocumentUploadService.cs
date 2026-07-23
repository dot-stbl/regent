using System.Security.Cryptography;
using Crm.Documents;

namespace Crm.Documents;

/// <summary>Strongly-typed identifier for a stored document.</summary>
public readonly record struct DocumentId(Guid Value)
{
    /// <summary>Creates a new <see cref="DocumentId"/>.</summary>
    public static DocumentId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Metadata describing an uploaded document.</summary>
public sealed record DocumentMetadata(
    string FileName,
    string MimeType,
    long SizeBytes,
    Guid OwnerOrgId,
    Guid? LinkedAccountId = null);

/// <summary>Outcome of a virus scan.</summary>
public enum ScanVerdict
{
    Clean = 0,
    Infected = 1,
    Error = 2,
}

/// <summary>Result of a single virus scan.</summary>
public sealed record ScanResult(ScanVerdict Verdict, string? Threat);

/// <summary>Document entity stored in the repository.</summary>
public sealed class Document
{
    /// <summary>Primary identifier.</summary>
    public DocumentId Id { get; set; }

    /// <summary>Original file name.</summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>MIME type reported by the client.</summary>
    public string MimeType { get; set; } = string.Empty;

    /// <summary>File size in bytes.</summary>
    public long SizeBytes { get; set; }

    /// <summary>SHA-256 of the file content (lower-case hex).</summary>
    public string Sha256 { get; set; } = string.Empty;

    /// <summary>Owning organisation.</summary>
    public Guid OwnerOrgId { get; set; }

    /// <summary>Optional link to the account the document is associated with.</summary>
    public Guid? LinkedAccountId { get; set; }

    /// <summary>Timestamp the document was stored.</summary>
    public DateTimeOffset StoredAt { get; set; }
}

/// <summary>Persistence surface for documents.</summary>
public interface IDocumentRepository
{
    /// <summary>Persists a document and returns its generated id.</summary>
    Task<DocumentId> SaveAsync(Document document, CancellationToken ct);
}

/// <summary>ClamAV client (kept abstract so this chunk is self-contained).</summary>
public interface IVirusScanner
{
    /// <summary>Scans the supplied stream.</summary>
    Task<ScanResult> ScanAsync(Stream content, CancellationToken ct);
}

/// <summary>
/// Uploads a document: scans for viruses, computes a content hash, then stores it.
/// </summary>
public sealed class DocumentUploadService
{
    private readonly IVirusScanner virusScanner;
    private readonly IDocumentRepository repository;
    private readonly ILogger<DocumentUploadService> logger;

    /// <summary>Constructs the service.</summary>
    public DocumentUploadService(
        IVirusScanner virusScanner,
        IDocumentRepository repository,
        ILogger<DocumentUploadService> logger)
    {
        this.virusScanner = virusScanner;
        this.repository = repository;
        this.logger = logger;
    }

    /// <summary>Uploads the supplied stream as a new document.</summary>
    /// <exception cref="InvalidOperationException">When the scan reports the file as infected.</exception>
    public async Task<DocumentId> UploadAsync(
        Stream content,
        DocumentMetadata metadata,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(metadata);

        if (metadata.SizeBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(metadata), "Size must be non-negative.");
        }

        var (hash, size) = await HashAsync(content, ct).ConfigureAwait(false);

        var scan = await virusScanner.ScanAsync(content, ct).ConfigureAwait(false);
        if (scan.Verdict == ScanVerdict.Infected)
        {
            logger.LogWarning(
                "Refusing upload of {FileName}: infected with {Threat}",
                metadata.FileName, scan.Threat);
            throw new InvalidOperationException(
                $"Document rejected: virus scanner reported '{scan.Threat}'.");
        }

        if (scan.Verdict == ScanVerdict.Error)
        {
            throw new InvalidOperationException(
                "Virus scanner failed; refusing to store the document.");
        }

        var document = new Document
        {
            Id = DocumentId.New(),
            FileName = metadata.FileName,
            MimeType = metadata.MimeType,
            SizeBytes = size,
            Sha256 = hash,
            OwnerOrgId = metadata.OwnerOrgId,
            LinkedAccountId = metadata.LinkedAccountId,
            StoredAt = DateTimeOffset.UtcNow,
        };

        return await repository.SaveAsync(document, ct).ConfigureAwait(false);
    }

    private static async Task<(string Hash, long Size)> HashAsync(Stream content, CancellationToken ct)
    {
        using var sha = SHA256.Create();
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await content.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
        {
            sha.TransformBlock(buffer, 0, read, null, 0);
            total += read;
        }
        sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return (Convert.ToHexString(sha.Hash!).ToLowerInvariant(), total);
    }
}
