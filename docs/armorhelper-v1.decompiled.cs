using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Resources;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Windows.Forms;
using AnimatedGif;
using ArmorHelper.Properties;
using Costura;
using Newtonsoft.Json;

[assembly: TargetFramework(".NETFramework,Version=v4.6", FrameworkDisplayName = ".NET Framework 4.6")]
[assembly: Guid("d7dd27fd-cc0d-4dd1-b2c2-ad57c325cea1")]
[assembly: ComVisible(false)]
[assembly: AssemblyTrademark("")]
[assembly: AssemblyCopyright("Copyright ©  2018")]
[assembly: AssemblyProduct("ArmorSheetGen")]
[assembly: AssemblyCompany("")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyDescription("")]
[assembly: AssemblyTitle("ArmorSheetGen")]
[assembly: Debuggable(DebuggableAttribute.DebuggingModes.IgnoreSymbolStoreSequencePoints)]
[assembly: RuntimeCompatibility(WrapNonExceptionThrows = true)]
[assembly: CompilationRelaxations(8)]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyVersion("1.0.0.0")]
internal class <Module>
{
	static <Module>()
	{
		AssemblyLoader.Attach();
	}
}
namespace ArmorHelper
{
	public class Program
	{
		[STAThread]
		public static void Main(string[] args)
		{
			Application.EnableVisualStyles();
			Application.Run((Form)(object)new Window(args));
		}
	}
	public class Config
	{
		public string importFolder;

		public string exportFolder;

		public bool[] exportCheckbox;
	}
	public class Window : Form
	{
		public class FileInfo
		{
			public string filePath;

			public DateTime? lastExport;

			public FileInfo(string filePath, DateTime? lastExport)
			{
				this.filePath = filePath;
				this.lastExport = lastExport;
			}
		}

		public delegate bool BitmapAction(Color[,] source, Color[,] dest, string file);

		[Serializable]
		[CompilerGenerated]
		private sealed class <>c
		{
			public static readonly <>c <>9 = new <>c();

			public static UnhandledExceptionEventHandler <>9__28_0;

			public static DragEventHandler <>9__28_1;

			public static Func<string, bool> <>9__28_8;

			public static LinkLabelLinkClickedEventHandler <>9__28_6;

			public static LinkLabelLinkClickedEventHandler <>9__28_7;

			internal void <.ctor>b__28_0(object sender, UnhandledExceptionEventArgs e)
			{
				if (e.ExceptionObject is Exception ex)
				{
					ShowWindow(consolePointer, 5);
					Console.WriteLine("Exception occured at " + DateTime.Now.ToShortTimeString() + "\n" + ex.Message + ":\n" + ex.StackTrace);
				}
			}

			internal void <.ctor>b__28_1(object sender, DragEventArgs e)
			{
				ShowWindow(consolePointer, 5);
				if (e.Data.GetDataPresent(DataFormats.FileDrop))
				{
					e.Effect = (DragDropEffects)(-2147483645);
				}
				else
				{
					e.Effect = (DragDropEffects)0;
				}
			}

			internal bool <.ctor>b__28_8(string s)
			{
				return File.Exists(s);
			}

			internal void <.ctor>b__28_6(object sender, LinkLabelLinkClickedEventArgs e)
			{
				Process.Start("https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/");
			}

			internal void <.ctor>b__28_7(object sender, LinkLabelLinkClickedEventArgs e)
			{
				Process.Start("https://www.patreon.com/Mirsario");
			}
		}

		private const int SW_HIDE = 0;

		private const int SW_SHOW = 5;

		public static Color colorGreen = Color.FromArgb(255, 77, 242, 93);

		public static Color colorYellow = Color.FromArgb(255, 255, 180, 5);

		public static Color colorRed = Color.FromArgb(255, 255, 64, 64);

		public static bool isWorking;

		public static bool isLoaded;

		public static IntPtr consolePointer;

		public static Dictionary<string, FileInfo> nameToInfo = new Dictionary<string, FileInfo>();

		public Timer timer;

		public GroupBox inputGroup;

		public OpenFileDialog fileDialog;

		public Button buttonChooseInput;

		public ListView inputList;

		public GroupBox outputGroup;

		public SaveFileDialog saveDialog;

		public Button buttonChooseOutput;

		public TextBox outputPath;

		public GroupBox optionsGroup;

		public CheckedListBox checkedList;

		public GroupBox exportGroup;

		public Button buttonExport;

		public LinkLabel forumLink;

		public LinkLabel creatorLink;

		private const string configFile = "config.json";

		[DllImport("kernel32.dll")]
		private static extern IntPtr GetConsoleWindow();

		[DllImport("user32.dll")]
		private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

		public Window(string[] args)
		{
			//IL_00ab: Unknown result type (might be due to invalid IL or missing references)
			//IL_00b0: Unknown result type (might be due to invalid IL or missing references)
			//IL_00c5: Unknown result type (might be due to invalid IL or missing references)
			//IL_00d4: Unknown result type (might be due to invalid IL or missing references)
			//IL_00df: Unknown result type (might be due to invalid IL or missing references)
			//IL_00e1: Unknown result type (might be due to invalid IL or missing references)
			//IL_00eb: Unknown result type (might be due to invalid IL or missing references)
			//IL_00ed: Expected O, but got Unknown
			//IL_00f2: Expected O, but got Unknown
			//IL_010d: Unknown result type (might be due to invalid IL or missing references)
			//IL_0112: Unknown result type (might be due to invalid IL or missing references)
			//IL_0132: Unknown result type (might be due to invalid IL or missing references)
			//IL_0139: Unknown result type (might be due to invalid IL or missing references)
			//IL_0140: Unknown result type (might be due to invalid IL or missing references)
			//IL_0147: Unknown result type (might be due to invalid IL or missing references)
			//IL_014e: Unknown result type (might be due to invalid IL or missing references)
			//IL_015a: Expected O, but got Unknown
			//IL_01b2: Unknown result type (might be due to invalid IL or missing references)
			//IL_01bc: Expected O, but got Unknown
			//IL_0221: Unknown result type (might be due to invalid IL or missing references)
			//IL_0226: Unknown result type (might be due to invalid IL or missing references)
			//IL_0238: Unknown result type (might be due to invalid IL or missing references)
			//IL_0262: Unknown result type (might be due to invalid IL or missing references)
			//IL_026d: Unknown result type (might be due to invalid IL or missing references)
			//IL_0270: Expected O, but got Unknown
			//IL_0275: Expected O, but got Unknown
			//IL_02cd: Unknown result type (might be due to invalid IL or missing references)
			//IL_02d2: Unknown result type (might be due to invalid IL or missing references)
			//IL_02e4: Unknown result type (might be due to invalid IL or missing references)
			//IL_02f8: Unknown result type (might be due to invalid IL or missing references)
			//IL_0303: Unknown result type (might be due to invalid IL or missing references)
			//IL_0305: Unknown result type (might be due to invalid IL or missing references)
			//IL_030f: Unknown result type (might be due to invalid IL or missing references)
			//IL_0311: Expected O, but got Unknown
			//IL_0316: Expected O, but got Unknown
			//IL_033c: Unknown result type (might be due to invalid IL or missing references)
			//IL_0341: Unknown result type (might be due to invalid IL or missing references)
			//IL_0361: Unknown result type (might be due to invalid IL or missing references)
			//IL_037a: Unknown result type (might be due to invalid IL or missing references)
			//IL_0381: Unknown result type (might be due to invalid IL or missing references)
			//IL_038c: Unknown result type (might be due to invalid IL or missing references)
			//IL_038f: Expected O, but got Unknown
			//IL_0394: Expected O, but got Unknown
			//IL_03c8: Unknown result type (might be due to invalid IL or missing references)
			//IL_03cd: Unknown result type (might be due to invalid IL or missing references)
			//IL_03df: Unknown result type (might be due to invalid IL or missing references)
			//IL_0409: Unknown result type (might be due to invalid IL or missing references)
			//IL_0414: Unknown result type (might be due to invalid IL or missing references)
			//IL_0417: Expected O, but got Unknown
			//IL_041c: Expected O, but got Unknown
			//IL_0474: Unknown result type (might be due to invalid IL or missing references)
			//IL_0479: Unknown result type (might be due to invalid IL or missing references)
			//IL_048b: Unknown result type (might be due to invalid IL or missing references)
			//IL_04a5: Unknown result type (might be due to invalid IL or missing references)
			//IL_04a7: Unknown result type (might be due to invalid IL or missing references)
			//IL_04b1: Unknown result type (might be due to invalid IL or missing references)
			//IL_04b3: Expected O, but got Unknown
			//IL_04b8: Expected O, but got Unknown
			//IL_04de: Unknown result type (might be due to invalid IL or missing references)
			//IL_04e3: Unknown result type (might be due to invalid IL or missing references)
			//IL_04f5: Unknown result type (might be due to invalid IL or missing references)
			//IL_0530: Unknown result type (might be due to invalid IL or missing references)
			//IL_0533: Expected O, but got Unknown
			//IL_0538: Expected O, but got Unknown
			//IL_055d: Unknown result type (might be due to invalid IL or missing references)
			//IL_0562: Unknown result type (might be due to invalid IL or missing references)
			//IL_0577: Unknown result type (might be due to invalid IL or missing references)
			//IL_0591: Unknown result type (might be due to invalid IL or missing references)
			//IL_059c: Unknown result type (might be due to invalid IL or missing references)
			//IL_059e: Unknown result type (might be due to invalid IL or missing references)
			//IL_05a8: Unknown result type (might be due to invalid IL or missing references)
			//IL_05aa: Expected O, but got Unknown
			//IL_05af: Expected O, but got Unknown
			//IL_05c1: Unknown result type (might be due to invalid IL or missing references)
			//IL_05c6: Unknown result type (might be due to invalid IL or missing references)
			//IL_05f1: Unknown result type (might be due to invalid IL or missing references)
			//IL_05f8: Unknown result type (might be due to invalid IL or missing references)
			//IL_05ff: Unknown result type (might be due to invalid IL or missing references)
			//IL_0606: Unknown result type (might be due to invalid IL or missing references)
			//IL_0609: Expected O, but got Unknown
			//IL_060e: Expected O, but got Unknown
			//IL_0622: Unknown result type (might be due to invalid IL or missing references)
			//IL_062c: Expected O, but got Unknown
			//IL_0195: Unknown result type (might be due to invalid IL or missing references)
			//IL_019a: Unknown result type (might be due to invalid IL or missing references)
			//IL_01a0: Expected O, but got Unknown
			//IL_06d9: Unknown result type (might be due to invalid IL or missing references)
			//IL_06de: Unknown result type (might be due to invalid IL or missing references)
			//IL_06f0: Unknown result type (might be due to invalid IL or missing references)
			//IL_0710: Unknown result type (might be due to invalid IL or missing references)
			//IL_071b: Unknown result type (might be due to invalid IL or missing references)
			//IL_0722: Unknown result type (might be due to invalid IL or missing references)
			//IL_072d: Unknown result type (might be due to invalid IL or missing references)
			//IL_0734: Unknown result type (might be due to invalid IL or missing references)
			//IL_0737: Expected O, but got Unknown
			//IL_073c: Expected O, but got Unknown
			//IL_0779: Unknown result type (might be due to invalid IL or missing references)
			//IL_077e: Unknown result type (might be due to invalid IL or missing references)
			//IL_0790: Unknown result type (might be due to invalid IL or missing references)
			//IL_07b0: Unknown result type (might be due to invalid IL or missing references)
			//IL_07bb: Unknown result type (might be due to invalid IL or missing references)
			//IL_07c2: Unknown result type (might be due to invalid IL or missing references)
			//IL_07cd: Unknown result type (might be due to invalid IL or missing references)
			//IL_07d4: Unknown result type (might be due to invalid IL or missing references)
			//IL_07d7: Expected O, but got Unknown
			//IL_07dc: Expected O, but got Unknown
			//IL_075d: Unknown result type (might be due to invalid IL or missing references)
			//IL_0762: Unknown result type (might be due to invalid IL or missing references)
			//IL_0768: Expected O, but got Unknown
			//IL_0841: Unknown result type (might be due to invalid IL or missing references)
			//IL_084b: Expected O, but got Unknown
			//IL_081e: Unknown result type (might be due to invalid IL or missing references)
			//IL_0823: Unknown result type (might be due to invalid IL or missing references)
			//IL_0829: Expected O, but got Unknown
			((Form)this)..ctor();
			AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
			{
				if (e.ExceptionObject is Exception ex)
				{
					ShowWindow(consolePointer, 5);
					Console.WriteLine("Exception occured at " + DateTime.Now.ToShortTimeString() + "\n" + ex.Message + ":\n" + ex.StackTrace);
				}
			};
			if (!File.Exists("ArmorTemplate_v1.png"))
			{
				try
				{
					((Image)Resources.TemplateInput).Save("ArmorTemplate_v1.png");
				}
				catch
				{
				}
			}
			consolePointer = GetConsoleWindow();
			ShowWindow(consolePointer, 0);
			((Control)this).Text = "ArmorHelper v1 Release";
			((Form)this).Size = new Size(640, 368);
			((Form)this).Icon = Resources.ArmorIcon;
			((Form)this).FormBorderStyle = (FormBorderStyle)1;
			((Form)this).MaximizeBox = false;
			((Form)this).CenterToScreen();
			ControlCollection controls = ((Control)this).Controls;
			GroupBox val = new GroupBox
			{
				Size = new Size(380, 152),
				Location = new Point(16, 16),
				Text = "Input Files",
				Padding = new Padding(8)
			};
			GroupBox val2 = val;
			inputGroup = val;
			controls.Add((Control)(object)val2);
			Point location = ((Control)inputGroup).DisplayRectangle.Location;
			inputList = new ListView
			{
				Size = new Size(((Control)inputGroup).DisplayRectangle.Width, 96),
				Location = location,
				View = (View)1,
				HeaderStyle = (ColumnHeaderStyle)0,
				FullRowSelect = true,
				AllowDrop = true
			};
			location.Y += ((Control)inputList).Size.Height;
			GroupBox obj2 = inputGroup;
			object obj3 = <>c.<>9__28_1;
			if (obj3 == null)
			{
				DragEventHandler val3 = delegate(object sender, DragEventArgs e)
				{
					ShowWindow(consolePointer, 5);
					if (e.Data.GetDataPresent(DataFormats.FileDrop))
					{
						e.Effect = (DragDropEffects)(-2147483645);
					}
					else
					{
						e.Effect = (DragDropEffects)0;
					}
				};
				<>c.<>9__28_1 = val3;
				obj3 = (object)val3;
			}
			((Control)obj2).DragEnter += (DragEventHandler)obj3;
			((Control)inputGroup).DragDrop += (DragEventHandler)delegate(object sender, DragEventArgs e)
			{
				try
				{
					AddFiles(((string[])e.Data.GetData(DataFormats.FileDrop)).Where((string s) => File.Exists(s)).ToArray());
				}
				catch
				{
				}
			};
			inputList.Columns.Add("File", ((Control)inputGroup).DisplayRectangle.Width / 2);
			inputList.Columns.Add("Time", -2);
			((Control)inputGroup).Controls.Add((Control)(object)inputList);
			ControlCollection controls2 = ((Control)inputGroup).Controls;
			Button val4 = new Button
			{
				Size = new Size(128, 32),
				Location = new Point(((Control)inputGroup).DisplayRectangle.Width / 2 - 64, location.Y),
				Text = "Choose..."
			};
			Button val5 = val4;
			buttonChooseInput = val4;
			controls2.Add((Control)(object)val5);
			location.Y += ((Control)buttonChooseInput).Size.Height;
			((Control)buttonChooseInput).Click += delegate
			{
				//IL_000a: Unknown result type (might be due to invalid IL or missing references)
				//IL_0014: Expected O, but got Unknown
				//IL_0046: Unknown result type (might be due to invalid IL or missing references)
				//IL_004c: Invalid comparison between Unknown and I4
				if (fileDialog == null)
				{
					fileDialog = new OpenFileDialog();
					((FileDialog)fileDialog).Filter = "Images (*.PNG;*.BMP)|*.PNG;*.BMP";
					fileDialog.Multiselect = true;
					((FileDialog)fileDialog).Title = "Choose Input Files...";
					if ((int)((CommonDialog)fileDialog).ShowDialog() == 1)
					{
						inputList.Items.Clear();
						AddFiles(((FileDialog)fileDialog).FileNames);
					}
					((Component)(object)fileDialog).Dispose();
					fileDialog = null;
					RefreshStuff();
					SaveConfig();
				}
			};
			location.Y = ((Control)inputGroup).Bottom;
			ControlCollection controls3 = ((Control)this).Controls;
			GroupBox val6 = new GroupBox
			{
				Size = new Size(380, 76),
				Location = new Point(16, location.Y),
				Text = "Output Folder",
				Padding = new Padding(8)
			};
			val2 = val6;
			outputGroup = val6;
			controls3.Add((Control)(object)val2);
			location = ((Control)outputGroup).DisplayRectangle.Location;
			ControlCollection controls4 = ((Control)outputGroup).Controls;
			TextBox val7 = new TextBox
			{
				Size = new Size(((Control)outputGroup).DisplayRectangle.Width, 20),
				Location = ((Control)outputGroup).DisplayRectangle.Location,
				ReadOnly = true,
				Text = Application.StartupPath
			};
			TextBox val8 = val7;
			outputPath = val7;
			controls4.Add((Control)(object)val8);
			location.Y += ((Control)outputPath).Size.Height;
			ControlCollection controls5 = ((Control)outputGroup).Controls;
			Button val9 = new Button
			{
				Size = new Size(128, 32),
				Location = new Point(((Control)outputGroup).DisplayRectangle.Width / 2 - 64, location.Y),
				Text = "Choose..."
			};
			val5 = val9;
			buttonChooseOutput = val9;
			controls5.Add((Control)(object)val5);
			location.Y += ((Control)buttonChooseOutput).Size.Height;
			((Control)buttonChooseOutput).Click += delegate
			{
				//IL_000a: Unknown result type (might be due to invalid IL or missing references)
				//IL_000f: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Unknown result type (might be due to invalid IL or missing references)
				//IL_0025: Unknown result type (might be due to invalid IL or missing references)
				//IL_002c: Unknown result type (might be due to invalid IL or missing references)
				//IL_003c: Expected O, but got Unknown
				//IL_0042: Unknown result type (might be due to invalid IL or missing references)
				//IL_0048: Invalid comparison between Unknown and I4
				if (saveDialog == null)
				{
					saveDialog = new SaveFileDialog
					{
						FileName = "Choose Output Folder",
						Title = "Choose Output Folder",
						ShowHelp = false,
						Filter = "Folder|."
					};
					if ((int)((CommonDialog)saveDialog).ShowDialog() == 1)
					{
						((Control)outputPath).Text = Path.GetDirectoryName(((FileDialog)saveDialog).FileName);
					}
					((Component)(object)saveDialog).Dispose();
					saveDialog = null;
					RefreshStuff();
					SaveConfig();
				}
			};
			location.Y = ((Control)inputGroup).Bottom;
			ControlCollection controls6 = ((Control)this).Controls;
			GroupBox val10 = new GroupBox
			{
				Size = new Size(380, 64),
				Location = new Point(16, ((Control)outputGroup).Bottom + 8),
				Padding = new Padding(8)
			};
			val2 = val10;
			exportGroup = val10;
			controls6.Add((Control)(object)val2);
			location = ((Control)exportGroup).DisplayRectangle.Location;
			ControlCollection controls7 = ((Control)exportGroup).Controls;
			Button val11 = new Button
			{
				Size = new Size(344, 32),
				Location = new Point(((Control)exportGroup).DisplayRectangle.Width / 2 - 172, ((Control)exportGroup).DisplayRectangle.Height / 2)
			};
			val5 = val11;
			buttonExport = val11;
			controls7.Add((Control)(object)val5);
			((Control)buttonExport).Click += Run;
			ControlCollection controls8 = ((Control)this).Controls;
			GroupBox val12 = new GroupBox
			{
				Size = new Size(204, 300),
				Location = new Point(((Control)inputGroup).Right + 8, 16),
				Text = "Options",
				Padding = new Padding(8)
			};
			val2 = val12;
			optionsGroup = val12;
			controls8.Add((Control)(object)val2);
			ControlCollection controls9 = ((Control)optionsGroup).Controls;
			CheckedListBox val13 = new CheckedListBox
			{
				Size = new Size(((Control)optionsGroup).DisplayRectangle.Size.Width, 208),
				Location = location,
				SelectionMode = (SelectionMode)1,
				CheckOnClick = true
			};
			CheckedListBox val14 = val13;
			checkedList = val13;
			controls9.Add((Control)(object)val14);
			checkedList.ItemCheck += (ItemCheckEventHandler)delegate
			{
				//IL_0008: Unknown result type (might be due to invalid IL or missing references)
				//IL_0012: Expected O, but got Unknown
				((Control)this).BeginInvoke((Delegate)(MethodInvoker)delegate
				{
					RefreshStuff();
					SaveConfig();
				});
			};
			((ObjectCollection)checkedList.Items).AddRange((object[])new string[13]
			{
				"Head", "Body", "Body (Female)", "Legs", "Arms", "Full Armor", "Full Armor (Female)", "Full Armor + Player", "Full Armor + Player (Female)", "GIF Full Armor",
				"GIF Full Armor (Female)", "GIF Full Armor + Player", "GIF Full Armor + Player (Female)"
			});
			for (int num = 0; num < 5; num++)
			{
				checkedList.SetItemChecked(num, true);
			}
			ControlCollection controls10 = ((Control)optionsGroup).Controls;
			LinkLabel val15 = new LinkLabel
			{
				Size = new Size(128, 20),
				Location = new Point(((Control)optionsGroup).Width / 2 - 64, 240),
				Text = "Forum Page",
				TextAlign = (ContentAlignment)2,
				LinkColor = Color.DarkViolet,
				LinkBehavior = (LinkBehavior)3
			};
			LinkLabel val16 = val15;
			forumLink = val15;
			controls10.Add((Control)(object)val16);
			LinkLabel obj4 = forumLink;
			object obj5 = <>c.<>9__28_6;
			if (obj5 == null)
			{
				LinkLabelLinkClickedEventHandler val17 = delegate
				{
					Process.Start("https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/");
				};
				<>c.<>9__28_6 = val17;
				obj5 = (object)val17;
			}
			obj4.LinkClicked += (LinkLabelLinkClickedEventHandler)obj5;
			ControlCollection controls11 = ((Control)optionsGroup).Controls;
			LinkLabel val18 = new LinkLabel
			{
				Size = new Size(128, 20),
				Location = new Point(((Control)optionsGroup).Width / 2 - 64, 267),
				Text = "Made by Mirsario",
				TextAlign = (ContentAlignment)2,
				LinkColor = Color.DarkViolet,
				LinkBehavior = (LinkBehavior)3
			};
			val16 = val18;
			creatorLink = val18;
			controls11.Add((Control)(object)val16);
			location.Y += ((Control)creatorLink).Size.Height;
			LinkLabel obj6 = creatorLink;
			object obj7 = <>c.<>9__28_7;
			if (obj7 == null)
			{
				LinkLabelLinkClickedEventHandler val19 = delegate
				{
					Process.Start("https://www.patreon.com/Mirsario");
				};
				<>c.<>9__28_7 = val19;
				obj7 = (object)val19;
			}
			obj6.LinkClicked += (LinkLabelLinkClickedEventHandler)obj7;
			LoadConfig();
			isLoaded = true;
			RefreshStuff();
			timer = new Timer();
			timer.Interval = 1000;
			timer.Tick += OnUpdate;
			timer.Start();
		}

		public void SaveConfig()
		{
			if (isLoaded)
			{
				Config config = new Config
				{
					exportCheckbox = new bool[((ObjectCollection)checkedList.Items).Count]
				};
				for (int i = 0; i < ((ObjectCollection)checkedList.Items).Count; i++)
				{
					config.exportCheckbox[i] = checkedList.GetItemChecked(i);
				}
				if (Directory.Exists(((Control)outputPath).Text) && !string.IsNullOrEmpty(((Control)outputPath).Text))
				{
					config.exportFolder = ((Control)outputPath).Text;
				}
				string contents = JsonConvert.SerializeObject((object)config, (Formatting)1).Replace("  ", "\t");
				File.WriteAllText("config.json", contents);
			}
		}

		public void LoadConfig()
		{
			if (File.Exists("config.json"))
			{
				Config config;
				using (StreamReader streamReader = new StreamReader("config.json"))
				{
					config = JsonConvert.DeserializeObject<Config>(streamReader.ReadToEnd());
				}
				for (int i = 0; i < ((ObjectCollection)checkedList.Items).Count; i++)
				{
					checkedList.SetItemChecked(i, config.exportCheckbox[i]);
				}
				if (config.exportFolder != null && Directory.Exists(config.exportFolder) && !string.IsNullOrEmpty(config.exportFolder))
				{
					((Control)outputPath).Text = config.exportFolder;
				}
			}
		}

		private void OnUpdate(object sender, EventArgs e)
		{
			if (!isWorking)
			{
				RefreshStuff();
			}
		}

		public void AddFiles(string[] files)
		{
			//IL_003c: Unknown result type (might be due to invalid IL or missing references)
			//IL_0042: Expected O, but got Unknown
			foreach (string text in files)
			{
				string fileName = Path.GetFileName(text);
				nameToInfo[fileName] = new FileInfo(text, null);
				ListViewItem val = new ListViewItem(new string[2] { fileName, "" });
				val.BackColor = colorYellow;
				inputList.Items.Add(val);
			}
			RefreshStuff();
		}

		public void RefreshStuff()
		{
			//IL_0116: Unknown result type (might be due to invalid IL or missing references)
			//IL_011d: Expected O, but got Unknown
			bool enabled = !isWorking && checkedList.CheckedItems.Count > 0;
			if (!Directory.Exists(((Control)outputPath).Text))
			{
				enabled = false;
				((Control)outputPath).BackColor = colorRed;
			}
			else
			{
				((Control)outputPath).BackColor = Color.FromArgb(255, 240, 240, 240);
			}
			if (inputList.Items.Count == 0)
			{
				enabled = false;
				((Control)inputList).BackColor = colorRed;
			}
			else
			{
				((Control)inputList).BackColor = Color.White;
			}
			((Control)buttonExport).Enabled = enabled;
			((Control)buttonExport).Text = (isWorking ? "Working..." : "Export");
			DateTime now = DateTime.Now;
			for (int i = 0; i < inputList.Items.Count; i++)
			{
				ListViewItem val = inputList.Items[i];
				string text = val.Text;
				FileInfo fileInfo = nameToInfo[text];
				ListViewSubItem val2 = null;
				foreach (ListViewSubItem subItem in val.SubItems)
				{
					ListViewSubItem val3 = subItem;
					if (val3.Text != text)
					{
						val2 = val3;
						break;
					}
				}
				if (!fileInfo.lastExport.HasValue)
				{
					val2.Text = "Never exported";
					continue;
				}
				TimeSpan timeSpan = now.Subtract(fileInfo.lastExport.Value);
				string text2 = "";
				if (timeSpan.Hours > 0)
				{
					text2 = text2 + timeSpan.Hours + "h ";
				}
				if (timeSpan.Minutes > 0)
				{
					text2 = text2 + timeSpan.Minutes + "m ";
				}
				if (timeSpan.Hours == 0)
				{
					text2 = text2 + timeSpan.Seconds + "s ";
				}
				if (timeSpan.Seconds >= 30)
				{
					val.BackColor = colorYellow;
				}
				val2.Text = "Last export was " + text2 + "ago";
			}
			((Control)this).Refresh();
		}

		public void Run(object sender, EventArgs e)
		{
			//IL_00ca: Unknown result type (might be due to invalid IL or missing references)
			//IL_00d4: Expected O, but got Unknown
			RefreshStuff();
			if (!((Control)buttonExport).Enabled)
			{
				return;
			}
			isWorking = true;
			RefreshStuff();
			for (int i = 0; i < inputList.Items.Count; i++)
			{
				ListViewItem val = inputList.Items[i];
				string text = val.Text;
				FileInfo fileInfo = nameToInfo[text];
				string filePath = fileInfo.filePath;
				bool flag = false;
				Console.WriteLine("Reading " + text);
				Image val2 = null;
				try
				{
					val2 = Image.FromFile(filePath);
				}
				catch
				{
					flag = true;
				}
				if (flag || val2.Width != 128 || val2.Height != 80)
				{
					ShowWindow(consolePointer, 5);
					Console.WriteLine("Bad input! Use the template PNG provided with this application as a base and don't change it's size (128x80).");
					val.BackColor = colorRed;
					RefreshStuff();
				}
				else
				{
					GenerateSheets(Path.GetFileNameWithoutExtension(text), (Bitmap)val2);
					val.BackColor = colorGreen;
					fileInfo.lastExport = DateTime.Now;
					RefreshStuff();
					Console.WriteLine("Done with that");
				}
			}
			isWorking = false;
			RefreshStuff();
		}

		public void GenerateSheets(string fileName, Bitmap input)
		{
			Color[,] array = new Color[((Image)input).Width, ((Image)input).Height];
			for (int i = 0; i < ((Image)input).Height; i++)
			{
				for (int j = 0; j < ((Image)input).Width; j++)
				{
					array[j, i] = input.GetPixel(j, i);
				}
			}
			int[] frontArmOffsets = new int[14]
			{
				0, -1, -1, -1, -1, 0, 0, 0, 1, 2,
				2, 1, 0, 0
			};
			int[] backArmOffsets = new int[14]
			{
				0, 1, 1, 1, 0, 0, 0, 0, -1, -2,
				-2, -1, 0, 0
			};
			int[] bodyHeadOffsets = new int[20]
			{
				0, 0, 0, 0, 0, 0, 0, -1, -1, -1,
				0, 0, 0, 0, -1, -1, -1, 0, 0, 0
			};
			int[][] legMapping = new int[10][]
			{
				new int[1] { 5 },
				new int[1] { 7 },
				new int[1] { 8 },
				new int[1] { 9 },
				new int[1] { 10 },
				new int[1] { 13 },
				new int[1] { 14 },
				new int[1] { 15 },
				new int[1] { 16 },
				new int[2] { 17, 18 }
			};
			BitmapAction frontArm = delegate(Color[,] s, Color[,] d, string file)
			{
				Copy(s, d, new Rectangle(1, 1, 12, 16), new Point(0, 9));
				Copy(s, d, new Rectangle(14, 1, 12, 16), new Point(0, 33));
				Copy(s, d, new Rectangle(27, 1, 16, 16), new Point(2, 61));
				Copy(s, d, new Rectangle(44, 1, 17, 16), new Point(2, 92));
				Copy(s, d, new Rectangle(62, 1, 16, 16), new Point(2, 121));
				Copy(s, d, new Rectangle(14, 1, 12, 16), new Point(0, 145), new Point[4]
				{
					new Point(22, 9),
					new Point(22, 10),
					new Point(22, 11),
					new Point(22, 12)
				});
				for (int k = 0; k < 14; k++)
				{
					int num = k + 6;
					Copy(s, d, new Rectangle(79, 1, 13, 11), new Point(frontArmOffsets[k], num * 28 + 12 + bodyHeadOffsets[num]));
				}
				return true;
			};
			BitmapAction backArm = delegate(Color[,] s, Color[,] d, string file)
			{
				Color[,] array3 = new Color[d.GetLength(0), d.GetLength(1)];
				Copy(s, array3, new Rectangle(94, 1, 12, 11), new Point(7, 14));
				Copy(s, array3, new Rectangle(94, 1, 12, 11), new Point(8, 40));
				Copy(s, array3, new Rectangle(94, 1, 12, 11), new Point(7, 70));
				for (int k = 0; k < 14; k++)
				{
					int num = k + 6;
					Copy(s, array3, new Rectangle(94, 1, 12, 11), new Point(8 + backArmOffsets[k], num * 28 + 12 + bodyHeadOffsets[num]));
					if (backArmOffsets[k] == -2)
					{
						Copy(s, array3, new Rectangle(101, 8, 1, 1), new Point(14, num * 28 + 18));
					}
				}
				for (int l = 0; l < 20; l++)
				{
					Fill(array3, new Rectangle(8, 21 + 28 * l, 6, 1), Color.Transparent);
				}
				Fill(array3, new Rectangle(0, 0, 13, 560), Color.Transparent);
				Copy(array3, d, new Rectangle(0, 0, d.GetLength(0), d.GetLength(1)), Point.Empty);
				array3 = null;
				return true;
			};
			Dictionary<string, (string toggleName, BitmapAction action)> actions = new Dictionary<string, (string, BitmapAction)>
			{
				{
					"Head",
					("Head", delegate(Color[,] source, Color[,] dest, string file)
					{
						for (int k = 0; k < 20; k++)
						{
							Copy(source, dest, new Rectangle(1, 19, 20, 28), new Point(0, k * 28 + bodyHeadOffsets[k]));
						}
						return true;
					})
				},
				{
					"Body",
					("Body", delegate(Color[,] source, Color[,] dest, string file)
					{
						backArm(source, dest, file);
						for (int k = 0; k < 20; k++)
						{
							int num = ((k == 5) ? 48 : 19);
							Copy(source, dest, new Rectangle(23, num, 20, 28), new Point(0, k * 28 + bodyHeadOffsets[k]), (k != 1 && k <= 5) ? null : new Point[2]
							{
								new Point(37, num + 16),
								new Point(37, num + 17)
							});
						}
						frontArm(source, dest, file);
						return true;
					})
				},
				{
					"Female",
					("Body (Female)", delegate(Color[,] source, Color[,] dest, string file)
					{
						backArm(source, dest, file);
						for (int k = 0; k < 20; k++)
						{
							Copy(source, dest, new Rectangle(44, (k == 5) ? 48 : 19, 20, 28), new Point(0, k * 28 + bodyHeadOffsets[k]));
						}
						frontArm(source, dest, file);
						return true;
					})
				},
				{
					"Legs",
					("Legs", delegate(Color[,] source, Color[,] dest, string file)
					{
						for (int k = 0; k < 7; k++)
						{
							int num = ((k < 5) ? k : ((k == 5) ? 11 : 19)) * 28;
							for (int l = 0; l < 2; l++)
							{
								bool flag = l == ((k != 6) ? 1 : 0);
								Copy(source, dest, new Rectangle((l == 1) ? 100 : 110, 19, 9, 9), new Point(flag ? 5 : 7, 19 + num), new Point[2]
								{
									new Point((l == 1) ? 101 : 111, 21),
									new Point((l == 1) ? 107 : 117, 21)
								});
							}
						}
						Copy(source, dest, new Rectangle(100, 19, 9, 9), new Point(6, 187));
						Copy(source, dest, new Rectangle(100, 19, 9, 9), new Point(6, 355));
						for (int m = 0; m < legMapping.Length; m++)
						{
							Rectangle sourceRect = new Rectangle((m >= 5) ? 83 : 66, 19 + m % 5 * 10, 16, 9);
							int[] array3 = legMapping[m];
							for (int n = 0; n < array3.Length; n++)
							{
								Copy(source, dest, sourceRect, new Point(3, 19 + array3[n] * 28));
							}
						}
						return true;
					})
				},
				{
					"Arms",
					("Arms", frontArm)
				}
			};
			actions.Add("FullArmor", ("Full Armor", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["Legs"].action(source, dest, file);
				actions["Body"].action(source, dest, file);
				actions["Head"].action(source, dest, file);
				frontArm(source, dest, file);
				return true;
			}));
			actions.Add("FullArmorFemale", ("Full Armor (Female)", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["Legs"].action(source, dest, file);
				actions["Female"].action(source, dest, file);
				actions["Head"].action(source, dest, file);
				frontArm(source, dest, file);
				return true;
			}));
			actions.Add("FullArmorPlayer", ("Full Armor + Player", delegate(Color[,] source, Color[,] dest, string file)
			{
				Copy(Resources.PlayerMale, dest, new Rectangle(0, 0, dest.GetLength(0), dest.GetLength(1)), Point.Empty, null, Color.FromArgb(255, 255, 150, 89));
				Copy(Resources.PlayerEyes, dest, new Rectangle(0, 0, dest.GetLength(0), dest.GetLength(1)), Point.Empty);
				actions["FullArmor"].action(source, dest, file);
				return true;
			}));
			actions.Add("FullArmorPlayerFemale", ("Full Armor + Player (Female)", delegate(Color[,] source, Color[,] dest, string file)
			{
				Copy(Resources.PlayerFemale, dest, new Rectangle(0, 0, dest.GetLength(0), dest.GetLength(1)), Point.Empty, null, Color.FromArgb(255, 255, 150, 89));
				Copy(Resources.PlayerEyes, dest, new Rectangle(0, 0, dest.GetLength(0), dest.GetLength(1)), Point.Empty);
				actions["FullArmorFemale"].action(source, dest, file);
				return true;
			}));
			actions.Add("GIFFullArmor", ("GIF Full Armor", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["FullArmor"].action(source, dest, file);
				SaveAsGif(dest, Path.ChangeExtension(file, ".gif"));
				return false;
			}));
			actions.Add("GIFFullArmorFemale", ("GIF Full Armor (Female)", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["FullArmorFemale"].action(source, dest, file);
				SaveAsGif(dest, Path.ChangeExtension(file, ".gif"));
				return false;
			}));
			actions.Add("GIFFullArmorPlayer", ("GIF Full Armor + Player", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["FullArmorPlayer"].action(source, dest, file);
				SaveAsGif(dest, Path.ChangeExtension(file, ".gif"));
				return false;
			}));
			actions.Add("GIFFullArmorPlayerFemale", ("GIF Full Armor + Player (Female)", delegate(Color[,] source, Color[,] dest, string file)
			{
				actions["FullArmorPlayerFemale"].action(source, dest, file);
				SaveAsGif(dest, Path.ChangeExtension(file, ".gif"));
				return false;
			}));
			foreach (KeyValuePair<string, (string, BitmapAction)> item in actions)
			{
				if (checkedList.CheckedItems.Contains((object)item.Value.Item1))
				{
					Color[,] array2 = new Color[20, 560];
					string text = ((Control)outputPath).Text + "/" + fileName + "_" + item.Key + ".png";
					if (item.Value.Item2(array, array2, text))
					{
						((Image)UpscaledBitmapFromPixels(array2, new Rectangle(0, 0, 20, 560))).Save(text, ImageFormat.Png);
					}
				}
			}
		}

		public static void Copy(Bitmap source, Color[,] dest, Rectangle sourceRect, Point destPoint, Point[] ignoredPoints = null, Color? color = null)
		{
			int width = ((Image)source).Width;
			int height = ((Image)source).Height;
			int length = dest.GetLength(0);
			int length2 = dest.GetLength(1);
			float num = 0f;
			float num2 = 0f;
			float num3 = 0f;
			if (color.HasValue)
			{
				num = (float)(int)color.Value.R / 255f;
				num2 = (float)(int)color.Value.G / 255f;
				num3 = (float)(int)color.Value.B / 255f;
			}
			for (int i = 0; i < sourceRect.Height; i++)
			{
				for (int j = 0; j < sourceRect.Width; j++)
				{
					int num4 = sourceRect.X + j;
					int num5 = sourceRect.Y + i;
					int num6 = destPoint.X + j;
					int num7 = destPoint.Y + i;
					if (num4 < 0 || num5 < 0 || num6 < 0 || num7 < 0 || num4 >= width || num5 >= height || num6 >= length || num7 >= length2)
					{
						continue;
					}
					Color color3;
					Color color2 = (color3 = source.GetPixel(num4, num5));
					if (color2.A > 1 && (ignoredPoints == null || !Enumerable.Contains(ignoredPoints, new Point(num4, num5))))
					{
						if (color.HasValue)
						{
							color3 = Color.FromArgb(color3.A, (byte)((float)(int)color3.R / 255f * num * 255f), (byte)((float)(int)color3.G / 255f * num2 * 255f), (byte)((float)(int)color3.B / 255f * num3 * 255f));
						}
						dest[num6, num7] = color3;
					}
				}
			}
		}

		public static void Copy(Color[,] source, Color[,] dest, Rectangle sourceRect, Point destPoint, Point[] ignoredPoints = null)
		{
			int length = source.GetLength(0);
			int length2 = source.GetLength(1);
			int length3 = dest.GetLength(0);
			int length4 = dest.GetLength(1);
			for (int i = 0; i < sourceRect.Height; i++)
			{
				for (int j = 0; j < sourceRect.Width; j++)
				{
					int num = sourceRect.X + j;
					int num2 = sourceRect.Y + i;
					int num3 = destPoint.X + j;
					int num4 = destPoint.Y + i;
					if (num >= 0 && num2 >= 0 && num3 >= 0 && num4 >= 0 && num < length && num2 < length2 && num3 < length3 && num4 < length4 && source[num, num2].A > 1 && (ignoredPoints == null || !Enumerable.Contains(ignoredPoints, new Point(num, num2))))
					{
						dest[num3, num4] = source[num, num2];
					}
				}
			}
		}

		public static void Fill(Color[,] dest, Rectangle destRect, Color fillColor)
		{
			int length = dest.GetLength(0);
			int length2 = dest.GetLength(1);
			for (int i = 0; i < destRect.Height; i++)
			{
				for (int j = 0; j < destRect.Width; j++)
				{
					int num = destRect.X + j;
					int num2 = destRect.Y + i;
					if (num >= 0 && num2 >= 0 && num < length && num2 < length2)
					{
						dest[num, num2] = fillColor;
					}
				}
			}
		}

		public static T[] CombineArrays<T>(params T[][] arrays)
		{
			int num = 0;
			for (int i = 0; i < arrays.Length; i++)
			{
				num += arrays[i].Length;
			}
			T[] array = new T[num];
			num = 0;
			for (int j = 0; j < arrays.Length; j++)
			{
				T[] array2 = arrays[j];
				Array.Copy(array2, 0, array, num, array2.Length);
				num += arrays[j].Length;
			}
			return array;
		}

		public static T[] ForLoop<T>(int amount, Func<int, T> func)
		{
			T[] array = new T[amount];
			for (int i = 0; i < amount; i++)
			{
				array[i] = func(i);
			}
			return array;
		}

		public static void SaveAsGif(Color[,] pixels, string file)
		{
			//IL_0004: Unknown result type (might be due to invalid IL or missing references)
			//IL_000a: Expected O, but got Unknown
			AnimatedGifCreator val = new AnimatedGifCreator(file, 66, 0);
			try
			{
				for (int i = 0; i < 5; i++)
				{
					bool flag = i == 2 || i == 4;
					bool flag2 = i == 3;
					for (int j = (flag2 ? 1 : ((!flag) ? 6 : 0)); j < (flag2 ? 5 : (flag ? 10 : 20)); j++)
					{
						int num = ((!flag) ? j : 0);
						Bitmap val2 = UpscaledBitmapFromPixels(pixels, new Rectangle(0, num * 28, 20, 28));
						try
						{
							val.AddFrame((Image)(object)val2, (GifQuality)1);
						}
						finally
						{
							((IDisposable)val2)?.Dispose();
						}
					}
				}
			}
			finally
			{
				((IDisposable)val)?.Dispose();
			}
		}

		public static Bitmap UpscaledBitmapFromPixels(Color[,] pixels, Rectangle rect)
		{
			//IL_0012: Unknown result type (might be due to invalid IL or missing references)
			//IL_0018: Expected O, but got Unknown
			Bitmap val = new Bitmap(rect.Width * 2, rect.Height * 2);
			for (int i = 0; i < rect.Height; i++)
			{
				for (int j = 0; j < rect.Width; j++)
				{
					for (int k = 0; k < 2; k++)
					{
						for (int l = 0; l < 2; l++)
						{
							val.SetPixel(j * 2 + l, i * 2 + k, pixels[rect.X + j, rect.Y + i]);
						}
					}
				}
			}
			return val;
		}
	}
}
namespace ArmorHelper.Properties
{
	[DebuggerNonUserCode]
	[GeneratedCode("System.Resources.Tools.StronglyTypedResourceBuilder", "15.0.0.0")]
	[CompilerGenerated]
	public class Resources
	{
		private static ResourceManager resourceMan;

		private static CultureInfo resourceCulture;

		[EditorBrowsable(EditorBrowsableState.Advanced)]
		public static ResourceManager ResourceManager
		{
			get
			{
				if (resourceMan == null)
				{
					resourceMan = new ResourceManager("ArmorHelper.Properties.Resources", typeof(Resources).Assembly);
				}
				return resourceMan;
			}
		}

		[EditorBrowsable(EditorBrowsableState.Advanced)]
		public static CultureInfo Culture
		{
			get
			{
				return resourceCulture;
			}
			set
			{
				resourceCulture = value;
			}
		}

		public static Icon ArmorIcon
		{
			get
			{
				//IL_0014: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Expected O, but got Unknown
				return (Icon)ResourceManager.GetObject("ArmorIcon", resourceCulture);
			}
		}

		public static Bitmap PlayerEyes
		{
			get
			{
				//IL_0014: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Expected O, but got Unknown
				return (Bitmap)ResourceManager.GetObject("PlayerEyes", resourceCulture);
			}
		}

		public static Bitmap PlayerFemale
		{
			get
			{
				//IL_0014: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Expected O, but got Unknown
				return (Bitmap)ResourceManager.GetObject("PlayerFemale", resourceCulture);
			}
		}

		public static Bitmap PlayerMale
		{
			get
			{
				//IL_0014: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Expected O, but got Unknown
				return (Bitmap)ResourceManager.GetObject("PlayerMale", resourceCulture);
			}
		}

		public static Bitmap TemplateInput
		{
			get
			{
				//IL_0014: Unknown result type (might be due to invalid IL or missing references)
				//IL_001a: Expected O, but got Unknown
				return (Bitmap)ResourceManager.GetObject("TemplateInput", resourceCulture);
			}
		}

		internal Resources()
		{
		}
	}
}
namespace Costura
{
	[CompilerGenerated]
	internal static class AssemblyLoader
	{
		private static object nullCacheLock = new object();

		private static Dictionary<string, bool> nullCache = new Dictionary<string, bool>();

		private static Dictionary<string, string> assemblyNames = new Dictionary<string, string>();

		private static Dictionary<string, string> symbolNames = new Dictionary<string, string>();

		private static int isAttached;

		private static string CultureToString(CultureInfo culture)
		{
			if (culture == null)
			{
				return "";
			}
			return culture.Name;
		}

		private static Assembly ReadExistingAssembly(AssemblyName name)
		{
			Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
			foreach (Assembly assembly in assemblies)
			{
				AssemblyName name2 = assembly.GetName();
				if (string.Equals(name2.Name, name.Name, StringComparison.InvariantCultureIgnoreCase) && string.Equals(CultureToString(name2.CultureInfo), CultureToString(name.CultureInfo), StringComparison.InvariantCultureIgnoreCase))
				{
					return assembly;
				}
			}
			return null;
		}

		private static void CopyTo(Stream source, Stream destination)
		{
			byte[] array = new byte[81920];
			int count;
			while ((count = source.Read(array, 0, array.Length)) != 0)
			{
				destination.Write(array, 0, count);
			}
		}

		private static Stream LoadStream(string fullname)
		{
			Assembly executingAssembly = Assembly.GetExecutingAssembly();
			if (fullname.EndsWith(".compressed"))
			{
				using (Stream stream = executingAssembly.GetManifestResourceStream(fullname))
				{
					using DeflateStream source = new DeflateStream(stream, CompressionMode.Decompress);
					MemoryStream memoryStream = new MemoryStream();
					CopyTo(source, memoryStream);
					memoryStream.Position = 0L;
					return memoryStream;
				}
			}
			return executingAssembly.GetManifestResourceStream(fullname);
		}

		private static Stream LoadStream(Dictionary<string, string> resourceNames, string name)
		{
			if (resourceNames.TryGetValue(name, out var value))
			{
				return LoadStream(value);
			}
			return null;
		}

		private static byte[] ReadStream(Stream stream)
		{
			byte[] array = new byte[stream.Length];
			stream.Read(array, 0, array.Length);
			return array;
		}

		private static Assembly ReadFromEmbeddedResources(Dictionary<string, string> assemblyNames, Dictionary<string, string> symbolNames, AssemblyName requestedAssemblyName)
		{
			string text = requestedAssemblyName.Name.ToLowerInvariant();
			if (requestedAssemblyName.CultureInfo != null && !string.IsNullOrEmpty(requestedAssemblyName.CultureInfo.Name))
			{
				text = $"{requestedAssemblyName.CultureInfo.Name}.{text}";
			}
			byte[] rawAssembly;
			using (Stream stream = LoadStream(assemblyNames, text))
			{
				if (stream == null)
				{
					return null;
				}
				rawAssembly = ReadStream(stream);
			}
			using (Stream stream2 = LoadStream(symbolNames, text))
			{
				if (stream2 != null)
				{
					byte[] rawSymbolStore = ReadStream(stream2);
					return Assembly.Load(rawAssembly, rawSymbolStore);
				}
			}
			return Assembly.Load(rawAssembly);
		}

		public static Assembly ResolveAssembly(object sender, ResolveEventArgs e)
		{
			lock (nullCacheLock)
			{
				if (nullCache.ContainsKey(e.Name))
				{
					return null;
				}
			}
			AssemblyName assemblyName = new AssemblyName(e.Name);
			Assembly assembly = ReadExistingAssembly(assemblyName);
			if (assembly != null)
			{
				return assembly;
			}
			assembly = ReadFromEmbeddedResources(assemblyNames, symbolNames, assemblyName);
			if (assembly == null)
			{
				lock (nullCacheLock)
				{
					nullCache[e.Name] = true;
				}
				if ((assemblyName.Flags & AssemblyNameFlags.Retargetable) != AssemblyNameFlags.None)
				{
					assembly = Assembly.Load(assemblyName);
				}
			}
			return assembly;
		}

		static AssemblyLoader()
		{
			assemblyNames.Add("animatedgif", "costura.animatedgif.dll.compressed");
			assemblyNames.Add("costura", "costura.costura.dll.compressed");
			assemblyNames.Add("newtonsoft.json", "costura.newtonsoft.json.dll.compressed");
			assemblyNames.Add("system.valuetuple", "costura.system.valuetuple.dll.compressed");
		}

		public static void Attach()
		{
			if (Interlocked.Exchange(ref isAttached, 1) != 1)
			{
				AppDomain.CurrentDomain.AssemblyResolve += ResolveAssembly;
			}
		}
	}
}
internal class ProcessedByFody
{
	internal const string FodyVersion = "3.0.0.0";

	internal const string Costura = "2.0.0.0";
}
