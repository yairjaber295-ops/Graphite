# Сборка Graphite.exe (запускалка окна редактора) + ярлыки в «Пуске» и в папке «Скрипты».
# Компилятор C# встроен в Windows (.NET Framework), ничего скачивать не нужно.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'Не найден компилятор C# (.NET Framework 4)' }
$exe = Join-Path $Root 'Graphite.exe'
& $csc /nologo /target:winexe /codepage:65001 /optimize+ "/win32icon:$Root\web\icons\app.ico" "/out:$exe" /r:System.Windows.Forms.dll "$PSScriptRoot\launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'Компиляция не удалась' }

$pythonw = (Get-Command pythonw.exe -ErrorAction Stop).Source
[IO.File]::WriteAllLines((Join-Path $Root 'Graphite.ini'), @($pythonw, $Root), (New-Object System.Text.UTF8Encoding($false)))

# AppUserModelID ярлыка = ID окна (app/desktop.py): закреплённая кнопка и запущенное окно — одна кнопка на панели задач
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Aumid {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink {}
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  interface IPropertyStore { void GetCount(out uint c); void GetAt(uint i, out PROPERTYKEY k); void GetValue(ref PROPERTYKEY k, out PROPVARIANT v); void SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); void Commit(); }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
  interface IPersistFile { void GetClassID(out Guid c); [PreserveSig] int IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool remember); void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f); void GetCurFile(out IntPtr f); }
  public static void Set(string lnk, string id) {
    object link = new CShellLink();
    ((IPersistFile)link).Load(lnk, 2);
    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    try { var st = (IPropertyStore)link; st.SetValue(ref key, ref v); st.Commit(); ((IPersistFile)link).Save(lnk, true); }
    finally { Marshal.FreeCoTaskMem(v.p); }
  }
}
'@

# ярлыки: меню «Пуск» и папка «Скрипты» (рабочий стол не трогаем)
$shell = New-Object -ComObject WScript.Shell
$targets = @(Join-Path ([Environment]::GetFolderPath('Programs')) 'Graphite.lnk')
$desk = [Environment]::GetFolderPath('Desktop')
$scripts = Get-ChildItem -LiteralPath $desk -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'Скрипты' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($scripts) { $targets += Join-Path $scripts 'Graphite.lnk' }
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$exe,0"
  $s.Description = 'Graphite — видеоредактор'
  $s.Save()
  [Aumid]::Set($lnk, 'Graphite.VideoEditor')
  Write-Host "ярлык: $lnk"
}
Write-Host "✅ Готово: $exe"
