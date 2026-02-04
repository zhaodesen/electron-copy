using System;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class Program
{
  private static readonly object SyncRoot = new();
  private static string _lastText = string.Empty;
  private static DateTime _lastSent = DateTime.MinValue;
  private static PipeSender? _sender;

  [STAThread]
  public static void Main(string[] args)
  {
    var pipeName = args.Length > 0 ? args[0] : "copy-app-uia";
    _sender = new PipeSender(pipeName);

    Automation.AddAutomationEventHandler(
      TextPattern.TextSelectionChangedEvent,
      AutomationElement.RootElement,
      TreeScope.Subtree,
      (_, _) => TryEmit()
    );

    Automation.AddAutomationFocusChangedEventHandler((_, __) => TryEmit());

    using var timer = new Timer(_ => TryEmit(), null, 1000, 1000);
    Thread.Sleep(Timeout.Infinite);
  }

  private static void TryEmit()
  {
    if (_sender == null) return;
    string? text = null;

    try
    {
      text = GetSelectedText();
    }
    catch
    {
      return;
    }

    if (string.IsNullOrWhiteSpace(text)) return;

    lock (SyncRoot)
    {
      var now = DateTime.UtcNow;
      if (text == _lastText && (now - _lastSent).TotalMilliseconds < 800)
      {
        return;
      }
      _lastText = text;
      _lastSent = now;
    }

    _sender.Send(text);
  }

  private static string? GetSelectedText()
  {
    var element = AutomationElement.FocusedElement;
    if (element == null) return null;

    if (element.Current.IsPassword) return null;

    if (!element.TryGetCurrentPattern(TextPattern.Pattern, out var patternObj))
    {
      return null;
    }

    var pattern = (TextPattern)patternObj;
    var ranges = pattern.GetSelection();
    if (ranges == null || ranges.Length == 0) return null;

    var text = ranges[0].GetText(-1);
    return text?.Trim();
  }
}

public sealed class PipeSender
{
  private readonly string _pipeName;

  public PipeSender(string pipeName)
  {
    _pipeName = pipeName;
  }

  public void Send(string text)
  {
    try
    {
      using var client = new NamedPipeClientStream(".", _pipeName, PipeDirection.Out);
      client.Connect(200);
      var data = Encoding.UTF8.GetBytes(text);
      client.Write(data, 0, data.Length);
    }
    catch
    {
      // Ignore if the Electron app isn't listening.
    }
  }
}
