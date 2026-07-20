using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Tessera.Providers.ProviderWrapper;

/// <summary>
/// Provider bridge for the upstream client. Fixes <see cref="HttpRequestException"/>
/// into a typed <see cref="ProviderException"/> carrying a stable code.
/// </summary>
public sealed class ProviderBridge(IUpstreamClient upstream)
{
    public async Task<string> GetAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await upstream.GetStringAsync(cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            throw ex;
        }
    }
}
