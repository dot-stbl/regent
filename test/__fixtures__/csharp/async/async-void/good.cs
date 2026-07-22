namespace Test;

using System.Threading.Tasks;

public sealed class ClickHandler
{
    public async Task HandleClickAsync(object sender, System.EventArgs e)
    {
        await Task.Yield();
    }
}
