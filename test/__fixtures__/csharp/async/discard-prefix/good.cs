namespace Test;

using System.Threading.Tasks;

public sealed class Cleanup
{
    public async Task RunAsync()
    {
        await Task.Run(() => 42);
    }
}
