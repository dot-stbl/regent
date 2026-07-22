namespace Test;

using System;

public sealed class Handler
{
    public void DoWork()
    {
        try
        {
            DoStep();
        }
        catch (ArgumentException e)
        {
            throw;
        }
    }

    private void DoStep() { }
}
