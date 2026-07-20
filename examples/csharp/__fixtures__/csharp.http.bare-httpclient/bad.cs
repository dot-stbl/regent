using System;
using System.Net.Http;
using System.Threading.Tasks;

namespace Tessera.Shared.Http;

/// <summary>
/// Authenticated upstream call site. Bare <c>new HttpClient()</c>
/// construction skips the configured factory, token handler, and
/// resilience pipeline.
/// </summary>
public sealed class DirectCallSite
{
    public async Task<string> GetServiceAsync(string baseUrl)
    {
        var client = new HttpClient();
        try
        {
            return await client.GetStringAsync($"{baseUrl}/health");
        }
        finally
        {
            client.Dispose();
        }
    }
}
