using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

public static class Program
{
  private static readonly object SyncRoot = new();
  private static string _currentText = string.Empty;
  private static Rect _currentRect = Rect.Empty;
  private static PipeSender? _sender;
  private static OverlayWindow? _overlay;
  private static Dispatcher? _dispatcher;
  private static Timer? _pollTimer;
  private static readonly string LogPath = Path.Combine(Path.GetTempPath(), "copy-app-uia.log");

  [STAThread]
  public static void Main(string[] args)
  {
    Log("Start");
    var pipeName = args.Length > 0 ? args[0] : "copy-app-uia";
    _sender = new PipeSender(pipeName);

    var app = new Application();
    _overlay = new OverlayWindow();
    _overlay.SaveClicked += HandleSaveClicked;
    _dispatcher = app.Dispatcher;

    Automation.AddAutomationEventHandler(
      TextPattern.TextSelectionChangedEvent,
      AutomationElement.RootElement,
      TreeScope.Subtree,
      (_, __) => TryUpdateSelection()
    );

    Automation.AddAutomationFocusChangedEventHandler((_, __) => TryUpdateSelection());

    _pollTimer = new Timer(_ => TryUpdateSelection(), null, 1000, 1000);
    app.Exit += (_, __) => _pollTimer?.Dispose();

    app.Dispatcher.InvokeAsync(TryUpdateSelection, DispatcherPriority.Background);
    app.Run();
  }

  private static void HandleSaveClicked()
  {
    string text;
    lock (SyncRoot)
    {
      text = _currentText;
    }

    if (string.IsNullOrWhiteSpace(text)) return;

    Log($"Click Save len={text.Length} preview={Preview(text)}");
    _sender?.Send(text);
    _dispatcher?.BeginInvoke(() => _overlay?.Hide(), DispatcherPriority.Background);
  }

  private static void TryUpdateSelection()
  {
    var info = GetSelectionInfo();
    if (_dispatcher == null) return;

    _dispatcher.BeginInvoke(() =>
    {
      if (_overlay == null) return;
      if (info == null)
      {
        _overlay.Hide();
        return;
      }

      lock (SyncRoot)
      {
        _currentText = info.Text;
        _currentRect = info.Rect;
      }

      _overlay.ShowAt(info.Rect);
    }, DispatcherPriority.Background);
  }

  private static SelectionInfo? GetSelectionInfo()
  {
    try
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
      if (string.IsNullOrWhiteSpace(text)) return null;

      object rectsObj = ranges[0].GetBoundingRectangles();
      if (rectsObj == null) return null;

      Rect rect;
      if (rectsObj is Rect[] rects)
      {
        if (rects.Length == 0) return null;
        rect = rects[0];
      }
      else if (rectsObj is double[] coords)
      {
        if (coords.Length < 4) return null;
        rect = new Rect(coords[0], coords[1], coords[2], coords[3]);
      }
      else
      {
        return null;
      }

      if (rect.Width < 1 || rect.Height < 1) return null;

      return new SelectionInfo(text.Trim(), rect);
    }
    catch
    {
      return null;
    }
  }

  private static void Log(string message)
  {
    try
    {
      var line = $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}";
      File.AppendAllText(LogPath, line);
    }
    catch
    {
      // ignore logging errors
    }
  }

  private static string Preview(string text)
  {
    if (string.IsNullOrEmpty(text)) return "";
    var cleaned = text.Replace("\r", " ").Replace("\n", " ");
    return cleaned.Length > 40 ? cleaned.Substring(0, 40) + "..." : cleaned;
  }
}

public sealed class OverlayWindow : Window
{
  public event Action? SaveClicked;
  private DateTime _lastClick = DateTime.MinValue;

  public OverlayWindow()
  {
    WindowStyle = WindowStyle.None;
    AllowsTransparency = true;
    Background = Brushes.Transparent;
    ShowInTaskbar = false;
    ResizeMode = ResizeMode.NoResize;
    SizeToContent = SizeToContent.WidthAndHeight;
    Topmost = true;
    ShowActivated = false;

    PreviewMouseLeftButtonDown += (_, __) => EmitSave();

    var border = new Border
    {
      Background = new SolidColorBrush(Color.FromRgb(15, 23, 42)),
      BorderBrush = new SolidColorBrush(Color.FromRgb(30, 41, 59)),
      BorderThickness = new Thickness(1),
      CornerRadius = new CornerRadius(10),
      Padding = new Thickness(12, 6, 12, 6)
    };

    var button = new Button
    {
      Content = "\u4fdd\u5b58",
      Background = Brushes.Transparent,
      BorderBrush = Brushes.Transparent,
      Foreground = Brushes.White,
      FontWeight = FontWeights.SemiBold,
      Padding = new Thickness(4, 2, 4, 2)
    };
    button.Click += (_, __) => EmitSave();

    border.Child = button;
    Content = border;
  }

  private void EmitSave()
  {
    var now = DateTime.UtcNow;
    if ((now - _lastClick).TotalMilliseconds < 300) return;
    _lastClick = now;
    SaveClicked?.Invoke();
  }

  public void ShowAt(Rect deviceRect)
  {
    if (!IsVisible)
    {
      Show();
    }

    var rect = ToDip(deviceRect);
    UpdateLayout();

    var x = rect.Left + rect.Width / 2 - ActualWidth / 2;
    var y = rect.Top - ActualHeight - 8;

    var screenLeft = SystemParameters.VirtualScreenLeft;
    var screenTop = SystemParameters.VirtualScreenTop;
    var screenRight = screenLeft + SystemParameters.VirtualScreenWidth;
    var screenBottom = screenTop + SystemParameters.VirtualScreenHeight;

    if (y < screenTop)
    {
      y = rect.Bottom + 8;
    }

    x = Math.Max(screenLeft, Math.Min(x, screenRight - ActualWidth));
    y = Math.Max(screenTop, Math.Min(y, screenBottom - ActualHeight));

    Left = x;
    Top = y;
  }

  private Rect ToDip(Rect rect)
  {
    var source = PresentationSource.FromVisual(this);
    var transform = source?.CompositionTarget?.TransformFromDevice;
    if (transform == null) return rect;

    var topLeft = transform.Value.Transform(new Point(rect.Left, rect.Top));
    var bottomRight = transform.Value.Transform(new Point(rect.Right, rect.Bottom));
    return new Rect(topLeft, bottomRight);
  }
}

public sealed class PipeSender
{
  private readonly string _pipeName;
  private readonly string _logPath = Path.Combine(Path.GetTempPath(), "copy-app-uia.log");

  public PipeSender(string pipeName)
  {
    _pipeName = pipeName;
  }

  public void Send(string text)
  {
    if (string.IsNullOrWhiteSpace(text)) return;
    var data = Encoding.UTF8.GetBytes(text);

    for (var attempt = 0; attempt < 3; attempt++)
    {
      try
      {
        using var client = new NamedPipeClientStream(
          ".",
          _pipeName,
          PipeDirection.Out,
          PipeOptions.Asynchronous
        );
        client.Connect(1000);
        client.Write(data, 0, data.Length);
        client.Flush();
        Log($"Pipe send ok attempt={attempt + 1} len={text.Length}");
        return;
      }
      catch (Exception ex)
      {
        Log($"Pipe send failed attempt={attempt + 1} err={ex.GetType().Name}");
        Thread.Sleep(80);
      }
    }
    Log("Pipe send failed all attempts");
  }

  private void Log(string message)
  {
    try
    {
      var line = $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}";
      File.AppendAllText(_logPath, line);
    }
    catch
    {
      // ignore logging errors
    }
  }
}

public sealed class SelectionInfo
{
  public SelectionInfo(string text, Rect rect)
  {
    Text = text;
    Rect = rect;
  }

  public string Text { get; }
  public Rect Rect { get; }
}
