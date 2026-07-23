using System.Security.Cryptography;
using Dlp.Scanning;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Dlp.Scanning;

/// <summary>
/// Abstraction for emitting audit entries (kept local so this file is self-contained).
/// </summary>
public interface IAuditSink
{
    /// <summary>Records that a payload was classified and whether egress was allowed.</summary>
    void RecordEgress(string url, Sensitivity sensitivity, string? matchedLabel, bool allowed);
}

/// <summary>
/// ASP.NET Core middleware that inspects outbound HTTP traffic and blocks payloads
/// classified as <see cref="Sensitivity.Sensitive"/> when the matching policy denies egress.
/// </summary>
public sealed class EgressInterceptor
{
    private readonly RequestDelegate next;
    private readonly FileClassifier classifier;
    private readonly IAuditSink audit;
    private readonly ILogger<EgressInterceptor> logger;

    /// <summary>Constructs the middleware.</summary>
    public EgressInterceptor(
        RequestDelegate next,
        FileClassifier classifier,
        IAuditSink audit,
        ILogger<EgressInterceptor> logger)
    {
        this.next = next;
        this.classifier = classifier;
        this.audit = audit;
        this.logger = logger;
    }

    /// <summary>ASP.NET Core middleware entry point.</summary>
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (!HttpMethods.IsPost(context.Request.Method) && !HttpMethods.IsPut(context.Request.Method))
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        context.Request.EnableBuffering();
        var body = await ReadBodyAsync(context.Request.Body, context.RequestAborted).ConfigureAwait(false);
        context.Request.Body.Position = 0;

        var hash = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant();
        var meta = new FileMetadata(
            Path: context.Request.Path,
            SizeBytes: body.Length,
            Sha256: hash,
            MimeType: context.Request.ContentType ?? "application/octet-stream",
            Attributes: new Dictionary<string, string>());

        var (sensitivity, policy) = await classifier
            .ClassifyAsync(meta, context.RequestAborted)
            .ConfigureAwait(false);

        var denied = sensitivity == Sensitivity.Sensitive && policy is not null;
        audit.RecordEgress(context.Request.Path, sensitivity, policy?.Label, !denied);

        if (denied)
        {
            logger.LogWarning(
                "Blocking egress to {Path}; matched policy {Policy} ({Sensitivity})",
                context.Request.Path, policy!.Label, sensitivity);

            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("Sensitive content egress is denied by policy.").ConfigureAwait(false);
            return;
        }

        await next(context).ConfigureAwait(false);
    }

    private static async Task<byte[]> ReadBodyAsync(Stream body, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        await body.CopyToAsync(ms, ct).ConfigureAwait(false);
        return ms.ToArray();
    }
}

/// <summary>Convenience extension for plugging the middleware into the pipeline.</summary>
public static class EgressInterceptorExtensions
{
    /// <summary>Appends the egress interceptor ahead of MVC.</summary>
    public static IApplicationBuilder UseEgressInterceptor(this IApplicationBuilder app)
        => app.UseMiddleware<EgressInterceptor>();
}
