using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("DeepSeek Desktop Companion Launcher")]
[assembly: AssemblyVersion("4.0.1.0")]

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LauncherForm(args));
    }
}

internal sealed class LauncherForm : Form
{
    private readonly string mode;
    private readonly string outputDirectory;
    private readonly string dataDirectory;
    private readonly string logPath;
    private readonly string statusPath;
    private readonly bool validArguments;
    private readonly Label heading = new Label();
    private readonly Label description = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly TextBox details = new TextBox();
    private readonly Button detailButton = new Button();
    private readonly Button copyButton = new Button();
    private readonly Button closeButton = new Button();
    private readonly object logLock = new object();
    private readonly StringBuilder capturedOutput = new StringBuilder();
    private Mutex operationMutex;
    private bool ownsMutex;
    private bool running;
    private bool expanded;
    private System.Windows.Forms.Timer successTimer;
    private DateTime startedAt;

    internal LauncherForm(string[] args)
    {
        validArguments = args.Length == 1 && (args[0] == "start" || args[0] == "stop" || args[0] == "chat");
        mode = validArguments ? args[0] : "invalid";
        outputDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string userProfile = Environment.GetEnvironmentVariable("USERPROFILE");
        if (String.IsNullOrWhiteSpace(userProfile) || !System.Text.RegularExpressions.Regex.IsMatch(userProfile, @"^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)")) userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        dataDirectory = Path.Combine(Path.GetFullPath(userProfile), ".deepseek-wallpaper-companion");
        logPath = Path.Combine(dataDirectory, "launcher-" + mode + "-last.log");
        statusPath = Path.Combine(dataDirectory, "launcher-" + mode + "-last.json");

        Text = "DeepSeek · 桌面助手";
        Font = new Font("Microsoft YaHei UI", 10F);
        BackColor = Color.White;
        ForeColor = Color.FromArgb(36, 47, 65);
        ClientSize = new Size(550, 220);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;

        heading.SetBounds(26, 23, 500, 35);
        heading.Font = new Font(Font.FontFamily, 16F, FontStyle.Bold);
        heading.Text = mode == "stop" ? "正在停止壁纸…" : mode == "chat" ? "正在打开聊天…" : "正在连接桌面房间…";
        description.SetBounds(28, 67, 493, 55);
        description.Text = "正在连接本地服务，请稍候。";
        progress.SetBounds(29, 132, 490, 7);
        progress.Style = ProgressBarStyle.Marquee;
        progress.MarqueeAnimationSpeed = 24;
        detailButton.SetBounds(26, 169, 110, 31);
        detailButton.Text = "查看详情";
        detailButton.FlatStyle = FlatStyle.Flat;
        detailButton.Click += delegate { ToggleDetails(); };
        copyButton.SetBounds(149, 169, 112, 31);
        copyButton.Text = "复制详情";
        copyButton.Enabled = false;
        copyButton.Click += delegate { try { Clipboard.SetText(details.Text + Environment.NewLine + "日志：" + logPath); } catch { } };
        closeButton.SetBounds(409, 169, 110, 31);
        closeButton.Text = "处理中…";
        closeButton.Enabled = false;
        closeButton.Click += delegate { Close(); };
        details.SetBounds(28, 220, 491, 205);
        details.Multiline = true;
        details.ReadOnly = true;
        details.ScrollBars = ScrollBars.Both;
        details.WordWrap = false;
        details.Font = new Font("Consolas", 9F);
        details.BackColor = Color.FromArgb(247, 249, 252);
        details.Visible = false;
        Controls.AddRange(new Control[] { heading, description, progress, detailButton, copyButton, closeButton, details });
        Shown += delegate { BeginInvoke(new Action(StartOperation)); };
        FormClosing += delegate(object sender, FormClosingEventArgs e)
        {
            if (running) { e.Cancel = true; description.Text = "操作仍在进行，完成后可关闭这个窗口。"; }
        };
        FormClosed += delegate { ReleaseOperationMutex(); if (operationMutex != null) operationMutex.Dispose(); };
    }

    private void StartOperation()
    {
        startedAt = DateTime.UtcNow;
        try
        {
            Directory.CreateDirectory(dataDirectory);
            File.WriteAllText(logPath, "DeepSeek launcher " + mode + " " + startedAt.ToString("o") + Environment.NewLine, new UTF8Encoding(true));
            if (!validArguments) throw new InvalidOperationException("启动方式无效。请使用桌面的壁纸、停止或聊天快捷方式。仅支持 start、stop、chat 三种操作。");
            string identity = WindowsIdentity.GetCurrent().User.Value;
            operationMutex = new Mutex(false, "Local\\DeepSeekWallpaperCompanionLauncher-" + identity);
            try { ownsMutex = operationMutex.WaitOne(0); }
            catch (AbandonedMutexException) { ownsMutex = true; }
            if (!ownsMutex) throw new InvalidOperationException("另一个壁纸或聊天操作仍在进行。请等待前一个窗口显示结果后再试。");

            string scriptName = mode == "start" ? "start-deepseek-wallpaper-v3.ps1" : mode == "stop" ? "stop-deepseek-wallpaper-v3.ps1" : "start-deepseek-chat-v4.ps1";
            string scriptPath = Path.Combine(outputDirectory, scriptName);
            if (!File.Exists(scriptPath)) throw new FileNotFoundException("缺少启动文件，请将完整的桌面助手文件保存在同一目录。", scriptPath);
            string windowsPowerShell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(windowsPowerShell)) throw new FileNotFoundException("找不到 Windows PowerShell 5.1。", windowsPowerShell);
            ProcessStartInfo info = new ProcessStartInfo(windowsPowerShell);
            info.Arguments = "-NoLogo -NoProfile -NonInteractive -File \"" + scriptPath + "\"" + (mode == "start" ? " -NoChat" : "");
            info.WorkingDirectory = outputDirectory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            Encoding childEncoding = Encoding.GetEncoding(CultureInfo.InstalledUICulture.TextInfo.OEMCodePage);
            info.StandardOutputEncoding = childEncoding;
            info.StandardErrorEncoding = childEncoding;
            // A native 5.1 process must not import modules from an inherited
            // PowerShell 7 installation. This changes only this child's environment.
            string nativeModules = Path.Combine(Path.GetDirectoryName(windowsPowerShell), "Modules");
            string systemModules = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsPowerShell", "Modules");
            string userModules = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "WindowsPowerShell", "Modules");
            info.EnvironmentVariables["PSModulePath"] = nativeModules + ";" + systemModules + ";" + userModules;
            string inheritedPolicy = info.EnvironmentVariables["PSExecutionPolicyPreference"];
            if (String.Equals(inheritedPolicy, "Bypass", StringComparison.OrdinalIgnoreCase) || String.Equals(inheritedPolicy, "Unrestricted", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("检测到父进程的临时执行策略不适合此启动器。请直接使用桌面快捷方式打开；启动器不会修改或绕过系统执行策略。");

            AppendLine("固定入口：" + scriptName);
            running = true;
            WriteStatus("running", null);
            Process child = new Process();
            child.StartInfo = info;
            ManualResetEvent outputClosed = new ManualResetEvent(false);
            ManualResetEvent errorClosed = new ManualResetEvent(false);
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLine(e.Data);
                else { try { outputClosed.Set(); } catch (ObjectDisposedException) { } }
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLine(e.Data);
                else { try { errorClosed.Set(); } catch (ObjectDisposedException) { } }
            };
            Stopwatch operationClock = Stopwatch.StartNew();
            if (!child.Start()) throw new InvalidOperationException("无法启动本地助手进程。");
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            Thread worker = new Thread(delegate()
            {
                int exitCode = -1;
                string error = null;
                try
                {
                    int remaining = Math.Max(0, 90000 - (int)operationClock.ElapsedMilliseconds);
                    if (!child.WaitForExit(remaining))
                    {
                        try { child.Kill(); } catch { }
                        error = "操作超过 90 秒仍未完成。已结束本次启动脚本，请查看日志后再试。";
                    }
                    else
                    {
                        exitCode = child.ExitCode;
                        // Native descendants may retain inherited pipe handles
                        // after the script exits. EOF is not a completion signal
                        // for that script; output draining has its own small,
                        // bounded share of the same total operation budget.
                        int drainBudget = Math.Min(1000, Math.Max(0, 90000 - (int)operationClock.ElapsedMilliseconds));
                        if (!WaitHandle.WaitAll(new WaitHandle[] { outputClosed, errorClosed }, drainBudget))
                            AppendLine("启动脚本已结束；后台程序继续运行，已结束输出采集。");
                    }
                }
                catch (Exception ex) { error = ex.Message; }
                finally
                {
                    // Cancel the readers before disposing the process. Never
                    // call the unbounded WaitForExit() overload to await EOF.
                    try { child.CancelOutputRead(); } catch { }
                    try { child.CancelErrorRead(); } catch { }
                    child.Dispose();
                    outputClosed.Dispose();
                    errorClosed.Dispose();
                }
                try { BeginInvoke(new Action(delegate { FinishOperation(exitCode, error); })); } catch { }
            });
            worker.IsBackground = true;
            worker.Start();
        }
        catch (Exception ex) { FinishOperation(-1, ex.Message); }
    }

    private void FinishOperation(int exitCode, string error)
    {
        running = false;
        ReleaseOperationMutex();
        progress.Style = ProgressBarStyle.Blocks;
        progress.Value = 100;
        closeButton.Enabled = true;
        copyButton.Enabled = true;
        if (exitCode == 0 && error == null)
        {
            heading.ForeColor = Color.FromArgb(25, 117, 83);
            heading.Text = mode == "stop" ? "壁纸已停止" : mode == "chat" ? "聊天已打开" : "桌面房间已连接";
            description.Text = mode == "stop" ? "已关闭本项目的桌面壁纸和本地服务。下次点击「DeepSeek 聊天」可重新连接。" : mode == "chat" ? "已连接当前房间和原来的对话。关闭聊天后，可随时从此快捷方式重新打开。" : "壁纸已就绪。聊天可从桌面的「DeepSeek 聊天」单独打开。";
            WriteStatus("succeeded", exitCode);
            int remaining = 5;
            closeButton.Text = "完成（5）";
            successTimer = new System.Windows.Forms.Timer();
            successTimer.Interval = 1000;
            successTimer.Tick += delegate { remaining--; if (remaining <= 0) { successTimer.Stop(); Close(); } else closeButton.Text = "完成（" + remaining + "）"; };
            successTimer.Start();
        }
        else
        {
            if (!String.IsNullOrWhiteSpace(error)) AppendLine(error);
            heading.ForeColor = Color.FromArgb(175, 62, 48);
            heading.Text = "操作未完成";
            description.Text = "请查看下面的具体错误。详情已保存，可复制后继续排查。";
            closeButton.Text = "关闭";
            if (!expanded) ToggleDetails();
            WriteStatus("failed", exitCode);
        }
    }

    private void AppendLine(string text)
    {
        lock (logLock)
        {
            capturedOutput.AppendLine(text);
            try { File.AppendAllText(logPath, text + Environment.NewLine, new UTF8Encoding(false)); } catch { }
        }
        try
        {
            if (InvokeRequired) BeginInvoke(new Action(delegate { details.AppendText(text + Environment.NewLine); }));
            else details.AppendText(text + Environment.NewLine);
        }
        catch { }
    }

    private void WriteStatus(string status, int? exitCode)
    {
        try
        {
            Dictionary<string, object> value = new Dictionary<string, object>();
            value["action"] = mode;
            value["status"] = status;
            value["startedAt"] = startedAt.ToString("o");
            value["updatedAt"] = DateTime.UtcNow.ToString("o");
            value["exitCode"] = exitCode;
            value["logPath"] = logPath;
            value["message"] = heading.Text;
            string temporary = statusPath + ".tmp-" + Process.GetCurrentProcess().Id;
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value), new UTF8Encoding(true));
            if (File.Exists(statusPath)) File.Delete(statusPath);
            File.Move(temporary, statusPath);
        }
        catch (Exception ex) { AppendLine("无法保存状态日志：" + ex.Message); }
    }

    private void ToggleDetails()
    {
        expanded = !expanded;
        details.Visible = expanded;
        ClientSize = expanded ? new Size(550, 450) : new Size(550, 220);
        detailButton.Text = expanded ? "收起详情" : "查看详情";
    }

    private void ReleaseOperationMutex()
    {
        if (ownsMutex && operationMutex != null)
        {
            try { operationMutex.ReleaseMutex(); } catch { }
            ownsMutex = false;
        }
    }
}
