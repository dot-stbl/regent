namespace Test;

using System;
using System.Net.Http;

public sealed class ProviderBridge
{
    public string GetBody()
    {
        try
        {
            return "ok";
        }
        catch (HttpRequestException ex)
        {
            throw ex;
        }
    }
}
