package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	kernel32           = syscall.NewLazyDLL("kernel32.dll")
	user32             = syscall.NewLazyDLL("user32.dll")
	getDiskFreeSpaceExW = kernel32.NewProc("GetDiskFreeSpaceExW")
	findWindowW         = user32.NewProc("FindWindowW")
	findWindowExW       = user32.NewProc("FindWindowExW")
	sendMessageW        = user32.NewProc("SendMessageW")
	getWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	enumWindows         = user32.NewProc("EnumWindows")
)

const (
	LVM_FIRST                = 0x1000
	LVM_GETITEMCOUNT         = LVM_FIRST + 4
	LVM_GETITEMTEXTW         = LVM_FIRST + 45
	LVM_GETITEMPOSITION      = LVM_FIRST + 16
	LVM_SETITEMPOSITION      = LVM_FIRST + 15
	LVIF_TEXT                = 0x0001
	LVIF_PARAM               = 0x0004
	MAX_PATH                 = 260
)

type POINT struct {
	X, Y int32
}

type LVITEM struct {
	Mask       uint32
	IItem      int32
	ISubItem   int32
	State      uint32
	StateMask  uint32
	PszText    uintptr
	CchTextMax int32
	IImage     int32
	LParam     uintptr
	IIndent    int32
	IGroupId   int32
	CColumns   uint32
	PuColumns  uintptr
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

type Settings struct {
	ArchiveRoot string `json:"archiveRoot"`
}

func (a *App) getSettingsPath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, _ := os.UserHomeDir()
		appData = filepath.Join(home, "AppData", "Roaming")
	}
	cfgDir := filepath.Join(appData, "Local", "darchi")
	os.MkdirAll(cfgDir, 0755)
	return filepath.Join(cfgDir, "settings.json")
}

func (a *App) GetSettings() Settings {
	path := a.getSettingsPath()
	var s Settings
	data, err := os.ReadFile(path)
	if err != nil {
		// default
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			home, _ := os.UserHomeDir()
			localAppData = filepath.Join(home, "AppData", "Local")
		}
		s.ArchiveRoot = filepath.Join(localAppData, "darchi")
		os.MkdirAll(s.ArchiveRoot, 0755)
		a.SaveSettings(s)
		return s
	}
	json.Unmarshal(data, &s)
	if s.ArchiveRoot == "" {
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			home, _ := os.UserHomeDir()
			localAppData = filepath.Join(home, "AppData", "Local")
		}
		s.ArchiveRoot = filepath.Join(localAppData, "darchi")
	}
	os.MkdirAll(s.ArchiveRoot, 0755)
	return s
}

func (a *App) SaveSettings(s Settings) error {
	path := a.getSettingsPath()
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (a *App) ChooseArchiveDir() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select archive location",
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", nil
	}
	// auto append darchi if not already ending with darchi
	base := filepath.Base(dir)
	if strings.ToLower(base) != "darchi" {
		dir = filepath.Join(dir, "darchi")
	}
	oldSettings := a.GetSettings()
	oldRoot := oldSettings.ArchiveRoot
	newRoot := dir
	if oldRoot == newRoot {
		a.SaveSettings(oldSettings)
		os.MkdirAll(newRoot, 0755)
		return newRoot, nil
	}
	// Calculate total size of old archives
	var totalSize int64
	entries, _ := os.ReadDir(oldRoot)
	for _, entry := range entries {
		if entry.IsDir() {
			p := filepath.Join(oldRoot, entry.Name())
			sz, _ := getDirSize(p)
			totalSize += sz
		}
	}
	free, err := getFreeSpace(newRoot)
	if err == nil {
		if uint64(totalSize) > free {
			return "", fmt.Errorf("not enough disk space")
		}
	}
	// Move all archives
	os.MkdirAll(newRoot, 0755)
	for _, entry := range entries {
		if entry.IsDir() {
			oldPath := filepath.Join(oldRoot, entry.Name())
			newPath := filepath.Join(newRoot, entry.Name())
			if _, err := os.Stat(newPath); err == nil {
				continue
			}
			if err := os.Rename(oldPath, newPath); err != nil {
				// try move by copy+delete
				if err := copyDir(oldPath, newPath); err == nil {
					os.RemoveAll(oldPath)
				}
			}
		}
	}
	s := Settings{ArchiveRoot: newRoot}
	a.SaveSettings(s)
	return newRoot, nil
}

func getDesktopPath() string {
	home, _ := os.UserHomeDir()
	// Try standard locations
	desktop := filepath.Join(home, "Desktop")
	if _, err := os.Stat(desktop); err == nil {
		return desktop
	}
	// OneDrive Desktop sometimes
	desktop = filepath.Join(home, "OneDrive", "Desktop")
	if _, err := os.Stat(desktop); err == nil {
		return desktop
	}
	return filepath.Join(home, "Desktop")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Sync()
}

func copyDir(src string, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, info.Mode()); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		s := filepath.Join(src, entry.Name())
		d := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := copyDir(s, d); err != nil {
				return err
			}
		} else {
			if err := copyFile(s, d); err != nil {
				return err
			}
		}
	}
	return nil
}

func getFreeSpace(path string) (uint64, error) {
	if goruntime.GOOS == "windows" {
		var freeBytesAvailable, totalBytes, totalFreeBytes uint64
		pathPtr, err := syscall.UTF16PtrFromString(path)
		if err != nil {
			return 0, err
		}
		r, _, e := getDiskFreeSpaceExW.Call(
			uintptr(unsafe.Pointer(pathPtr)),
			uintptr(unsafe.Pointer(&freeBytesAvailable)),
			uintptr(unsafe.Pointer(&totalBytes)),
			uintptr(unsafe.Pointer(&totalFreeBytes)),
		)
		if r == 0 {
			return 0, e
		}
		return freeBytesAvailable, nil
	}
	// fallback: not implemented for other platforms
	return 1<<62, nil
}

func getDirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}

type IconPos struct {
	Name string `json:"name"`
	X    int32  `json:"x"`
	Y    int32  `json:"y"`
}

func (a *App) getDesktopListView() uintptr {
	// Find Progman then SHELLDLL_DefView then SysListView32
	progman, _, _ := findWindowW.Call(uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("Progman"))), 0)
	shellView, _, _ := findWindowExW.Call(progman, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SHELLDLL_DefView"))), 0)
	if shellView == 0 {
		// try WorkerW
		var enumProc = syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
			defView, _, _ := findWindowExW.Call(hwnd, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SHELLDLL_DefView"))), 0)
			if defView != 0 {
				listView, _, _ := findWindowExW.Call(defView, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SysListView32"))), 0)
				if listView != 0 {
					// store in global? easier: use find again pattern
				}
			}
			return 1
		})
		_ = enumProc
	}
	listView, _, _ := findWindowExW.Call(shellView, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SysListView32"))), 0)
	if listView == 0 {
		// search all
		var found uintptr
		var cb = syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
			defView, _, _ := findWindowExW.Call(hwnd, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SHELLDLL_DefView"))), 0)
			if defView != 0 {
				lv, _, _ := findWindowExW.Call(defView, 0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("SysListView32"))), 0)
				if lv != 0 {
					ptr := (*uintptr)(unsafe.Pointer(lparam))
					*ptr = lv
					return 0
				}
			}
			return 1
		})
		enumWindows.Call(cb, uintptr(unsafe.Pointer(&found)))
		return found
	}
	return listView
}

func (a *App) SaveDesktopIconPositions() ([]IconPos, error) {
	hwnd := a.getDesktopListView()
	if hwnd == 0 {
		return []IconPos{}, nil
	}
	count, _, _ := sendMessageW.Call(hwnd, LVM_GETITEMCOUNT, 0, 0)
	var positions []IconPos
	for i := int32(0); i < int32(count); i++ {
		var pt POINT
		res, _, _ := sendMessageW.Call(hwnd, LVM_GETITEMPOSITION, uintptr(i), uintptr(unsafe.Pointer(&pt)))
		if res == 0 {
			continue
		}
		// get name
		buf := make([]uint16, MAX_PATH)
		var item LVITEM
		item.Mask = LVIF_TEXT
		item.IItem = i
		item.ISubItem = 0
		item.PszText = uintptr(unsafe.Pointer(&buf[0]))
		item.CchTextMax = MAX_PATH
		sendMessageW.Call(hwnd, LVM_GETITEMTEXTW, uintptr(i), uintptr(unsafe.Pointer(&item)))
		name := syscall.UTF16ToString(buf)
		if name == "" {
			continue
		}
		positions = append(positions, IconPos{Name: name, X: pt.X, Y: pt.Y})
	}
	return positions, nil
}

func (a *App) RestoreDesktopIconPositions(positions []IconPos) error {
	if goruntime.GOOS != "windows" {
		return nil
	}
	hwnd := a.getDesktopListView()
	if hwnd == 0 {
		return nil
	}
	count, _, _ := sendMessageW.Call(hwnd, LVM_GETITEMCOUNT, 0, 0)
	for _, pos := range positions {
		// find item index by name
		for i := int32(0); i < int32(count); i++ {
			buf := make([]uint16, MAX_PATH)
			var item LVITEM
			item.Mask = LVIF_TEXT
			item.IItem = i
			item.ISubItem = 0
			item.PszText = uintptr(unsafe.Pointer(&buf[0]))
			item.CchTextMax = MAX_PATH
			sendMessageW.Call(hwnd, LVM_GETITEMTEXTW, uintptr(i), uintptr(unsafe.Pointer(&item)))
			name := syscall.UTF16ToString(buf)
			if strings.EqualFold(name, pos.Name) {
				sendMessageW.Call(hwnd, LVM_SETITEMPOSITION, uintptr(i), uintptr((uint32(pos.Y)<<16)|uint32(pos.X&0xFFFF)))
				break
			}
		}
	}
	return nil
}

func (a *App) ArchiveDesktop() (string, error) {
	desktop := getDesktopPath()
	s := a.GetSettings()
	root := s.ArchiveRoot
	os.MkdirAll(root, 0755)

	// Check disk space before starting
	desktopSize, _ := getDirSize(desktop)
	free, err := getFreeSpace(root)
	if err == nil {
		if uint64(desktopSize) > free {
			return "", fmt.Errorf("not enough disk space")
		}
	}

	// Save icon positions
	iconPositions, _ := a.SaveDesktopIconPositions()

	// Generate name: like 27 Oct 2026
	now := time.Now()
	name := now.Format("02 Jan 2006")
	// Check for duplicates today
	baseName := name
	for i := 2; ; i++ {
		target := filepath.Join(root, name)
		if _, err := os.Stat(target); os.IsNotExist(err) {
			break
		} else {
			name = fmt.Sprintf("%s_%d", baseName, i)
		}
	}

	targetDir := filepath.Join(root, name)
	filesDir := filepath.Join(targetDir, "files")
	if err := os.MkdirAll(filesDir, 0755); err != nil {
		return "", err
	}

	entries, err := os.ReadDir(desktop)
	if err != nil {
		return "", err
	}
	// Count total items
	total := 0
	for _, entry := range entries {
		nameEnt := entry.Name()
		lname := strings.ToLower(nameEnt)
		if lname == "recycle.bin" || lname == "$recycle.bin" || lname == "my computer" || lname == "this pc" || lname == "darchi.exe" {
			continue
		}
		total++
	}
	current := 0
	for _, entry := range entries {
		nameEnt := entry.Name()
		// Skip Recycle Bin and My PC representations if they appear as special
		lname := strings.ToLower(nameEnt)
		if lname == "recycle.bin" || lname == "$recycle.bin" || lname == "my computer" || lname == "this pc" || lname == "darchi.exe" {
			continue
		}
		current++
		runtime.EventsEmit(a.ctx, "archive:progress", map[string]interface{}{"current": current, "total": total, "message": fmt.Sprintf("%d/%d", current, total)})
		src := filepath.Join(desktop, nameEnt)
		dst := filepath.Join(filesDir, nameEnt)
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.IsDir() {
			if err := os.Rename(src, dst); err != nil {
				if err := copyDir(src, dst); err == nil {
					os.RemoveAll(src)
				} else {
					continue
				}
			}
		} else {
			if err := os.Rename(src, dst); err != nil {
				if err := copyFile(src, dst); err == nil {
					os.Remove(src)
				} else {
					continue
				}
			}
		}
	}

	// Save info.json
	infoPath := filepath.Join(targetDir, "info.json")
	if iconPositions == nil {
		iconPositions = []IconPos{}
	}
	if data, err := json.MarshalIndent(map[string]interface{}{
		"iconPositions": iconPositions,
		"date":           strings.ToLower(now.Format("02 Jan 2006, 15:04")),
	}, "", "  "); err == nil {
		os.WriteFile(infoPath, data, 0644)
	} else {
		os.WriteFile(infoPath, []byte("{\"iconPositions\":[]}"), 0644)
	}

	return name, nil
}

type ArchiveFile struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	IsDir     bool   `json:"isDir"`
	Size      int64  `json:"size"`
	ModTime   string `json:"modTime"`
	Icon      string `json:"icon"`
	Duplicate bool   `json:"duplicate"`
	OnDesktop bool   `json:"onDesktop"`
}

type Archive struct {
	Name      string        `json:"name"`
	Path      string        `json:"path"`
	Created   string        `json:"created"`
	Files     []ArchiveFile `json:"files"`
}

func normalizeArchiveDate(s string, fallback time.Time) string {
    layouts := []string{
        "02 Jan 2006, 15:04",
        "02 Jan 2006 15:04",
        "2006-01-02 15:04:05",
        "2006-01-02 15:04",
        "02 Jan 2006",
    }
    for _, l := range layouts {
        if t, err := time.Parse(l, s); err == nil {
            return strings.ToLower(t.Format("02 Jan 2006, 15:04"))
        }
    }
    if s == "" {
        return strings.ToLower(fallback.Format("02 Jan 2006, 15:04"))
    }
    return s
}

func (a *App) ListArchives() ([]Archive, error) {
	s := a.GetSettings()
	root := s.ArchiveRoot
	os.MkdirAll(root, 0755)
	entries, err := os.ReadDir(root)
	if err != nil {
		return []Archive{}, nil
	}
	var result []Archive
	hasArchiveDir := false
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		hasArchiveDir = true
		archPath := filepath.Join(root, entry.Name())
		filesDir := filepath.Join(archPath, "files")
		if _, err := os.Stat(filesDir); os.IsNotExist(err) {
			// migrate old structure
			if files, err := a.listFilesInDir(archPath); err == nil && len(files) > 0 {
				// check if has files (not info.json)
				hasReal := false
				for _, f := range files {
					if f.Name != "info.json" {
						hasReal = true
						break
					}
				}
				if hasReal {
					os.MkdirAll(filesDir, 0755)
					for _, f := range files {
						if f.Name == "info.json" {
							continue
						}
						old := filepath.Join(archPath, f.Name)
						nw := filepath.Join(filesDir, f.Name)
						os.Rename(old, nw)
					}
				}
			}
		}
		files, _ := a.listFilesInDir(filesDir)
		if len(files) == 0 {
			files, _ = a.listFilesInDir(archPath)
			filtered := []ArchiveFile{}
			for _, f := range files {
				if f.Name == "info.json" {
					continue
				}
				filtered = append(filtered, f)
			}
			files = filtered
		}
		created := ""
		// Try to read date from info.json
		if data, err := os.ReadFile(filepath.Join(archPath, "info.json")); err == nil {
			var m map[string]interface{}
			if json.Unmarshal(data, &m) == nil {
				if d, ok := m["date"].(string); ok && d != "" {
					created = d
				}
			}
		}
		fallback := time.Now()
		if err == nil {
			fallback = info.ModTime()
		}
		created = normalizeArchiveDate(created, fallback)
		result = append(result, Archive{
			Name:    entry.Name(),
			Path:    archPath,
			Created: created,
			Files:   files,
		})
	}
	if !hasArchiveDir {
		return []Archive{}, nil
	}
	// sort archives by created date descending (newest first)
	sort.Slice(result, func(i, j int) bool {
		ti, erri := time.Parse("02 Jan 2006, 15:04", result[i].Created)
		tj, errj := time.Parse("02 Jan 2006, 15:04", result[j].Created)
		if erri != nil || errj != nil {
			// fallback: parse case-insensitively via Title
			ti, _ = time.Parse("02 Jan 2006, 15:04", strings.Title(strings.ToLower(result[i].Created)))
			tj, _ = time.Parse("02 Jan 2006, 15:04", strings.Title(strings.ToLower(result[j].Created)))
		}
		return ti.After(tj)
	})
	desktop := getDesktopPath()
	for i := range result {
		for j := range result[i].Files {
			dst := filepath.Join(desktop, result[i].Files[j].Name)
			if _, err := os.Stat(dst); err == nil {
				result[i].Files[j].OnDesktop = true
			}
		}
	}
	// detect duplicate file/folder names across archives
	nameCount := map[string]int{}
	for _, a := range result {
		for _, f := range a.Files {
			nameCount[f.Name]++
		}
	}
	for i := range result {
		for j := range result[i].Files {
			if nameCount[result[i].Files[j].Name] > 1 {
				result[i].Files[j].Duplicate = true
			}
		}
	}
	return result, nil
}

func extractFileIcon(path string) string {
	return ""
}
func (a *App) listFilesInDir(dir string) ([]ArchiveFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []ArchiveFile{}, nil
	}
	var files []ArchiveFile
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(dir, entry.Name())
		icon := ""
		if !entry.IsDir() {
			icon = extractFileIcon(full)
		}
		files = append(files, ArchiveFile{
			Name:    entry.Name(),
			Path:    full,
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
			Icon:    icon,
		})
	}
	return files, nil
}

func (a *App) RenameArchive(oldName, newName string) error {
	s := a.GetSettings()
	root := s.ArchiveRoot
	oldPath := filepath.Join(root, oldName)
	newPath := filepath.Join(root, newName)
	if oldPath == newPath {
		return nil
	}
	// check if exists
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("already exists")
	}
	return os.Rename(oldPath, newPath)
}

func (a *App) OpenFileLocation(path string) error {
	if goruntime.GOOS == "windows" {
		// explorer /select
		cmd := exec.Command("explorer", "/select,", path)
		return cmd.Start()
	} else if goruntime.GOOS == "darwin" {
		cmd := exec.Command("open", "-R", path)
		return cmd.Start()
	}
	cmd := exec.Command("xdg-open", filepath.Dir(path))
	return cmd.Start()
}

func (a *App) OpenFolderLocation(path string) error {
	if goruntime.GOOS == "windows" {
		cmd := exec.Command("explorer", path)
		return cmd.Start()
	} else if goruntime.GOOS == "darwin" {
		cmd := exec.Command("open", path)
		return cmd.Start()
	}
	cmd := exec.Command("xdg-open", path)
	return cmd.Start()
}

func (a *App) MoveToDesktop(srcPath string) error {
	desktop := getDesktopPath()
	name := filepath.Base(srcPath)
	dst := filepath.Join(desktop, name)
	// if exists, add suffix?
	if _, err := os.Stat(dst); err == nil {
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		for i := 1; ; i++ {
			newName := fmt.Sprintf("%s_%d%s", base, i, ext)
			dst = filepath.Join(desktop, newName)
			if _, err := os.Stat(dst); os.IsNotExist(err) {
				break
			}
		}
	}
	info, err := os.Stat(srcPath)
	if err != nil {
		return err
	}
	// try direct move first (same drive)
	if err := os.Rename(srcPath, dst); err == nil {
		// success
	} else {
		// fallback: copy then delete
		if info.IsDir() {
			if err := copyDir(srcPath, dst); err != nil {
				return err
			}
			os.RemoveAll(srcPath)
		} else {
			if err := copyFile(srcPath, dst); err != nil {
				return err
			}
			os.Remove(srcPath)
		}
	}
	// Try to restore icon positions from archive info.json
	// Find archive root
	archPath := filepath.Dir(filepath.Dir(srcPath))
	infoPath := filepath.Join(archPath, "info.json")
	if data, err := os.ReadFile(infoPath); err == nil {
		var m map[string]interface{}
		if json.Unmarshal(data, &m) == nil {
			if ips, ok := m["iconPositions"]; ok {
				if arr, ok := ips.([]interface{}); ok {
					var positions []IconPos
					for _, v := range arr {
						if mv, ok := v.(map[string]interface{}); ok {
							n, _ := mv["name"].(string)
							var x, y int32
							if fx, ok := mv["x"].(float64); ok {
								x = int32(fx)
							}
							if fy, ok := mv["y"].(float64); ok {
								y = int32(fy)
							}
							if n != "" {
								positions = append(positions, IconPos{Name: n, X: x, Y: y})
							}
						}
					}
					// small delay to let icon appear
					time.Sleep(200 * time.Millisecond)
					a.RestoreDesktopIconPositions(positions)
				}
			}
		}
	}
	// if the archive's files folder is now empty, remove the whole archive
	filesDir := filepath.Join(archPath, "files")
	if entries, err := os.ReadDir(filesDir); err == nil && len(entries) == 0 {
		os.Remove(filepath.Join(archPath, "info.json"))
		os.Remove(filesDir)
		if entries2, err2 := os.ReadDir(archPath); err2 == nil && len(entries2) == 0 {
			os.RemoveAll(archPath)
		}
	}
	return nil
}

func (a *App) RestoreDesktopFromArchive(archiveName string) (string, error) {
	// First archive current desktop
	newName, err := a.ArchiveDesktop()
	if err != nil {
		return "", err
	}
	s := a.GetSettings()
	root := s.ArchiveRoot
	archPath := filepath.Join(root, archiveName)
	desktop := getDesktopPath()

	// Read icon positions
	var positions []IconPos
	infoPath := filepath.Join(archPath, "info.json")
	if data, err := os.ReadFile(infoPath); err == nil {
		var m map[string]interface{}
		if json.Unmarshal(data, &m) == nil {
			if ips, ok := m["iconPositions"]; ok {
				if arr, ok := ips.([]interface{}); ok {
					for _, v := range arr {
						if mv, ok := v.(map[string]interface{}); ok {
							n, _ := mv["name"].(string)
							var x, y int32
							if fx, ok := mv["x"].(float64); ok {
								x = int32(fx)
							}
							if fy, ok := mv["y"].(float64); ok {
								y = int32(fy)
							}
							if n != "" {
								positions = append(positions, IconPos{Name: n, X: x, Y: y})
							}
						}
					}
				}
			}
		}
	}

	// Get files from archive
	filesDir := filepath.Join(archPath, "files")
	srcDir := filesDir
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		srcDir = archPath
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		nameEnt := entry.Name()
		if nameEnt == "info.json" {
			continue
		}
		lname := strings.ToLower(nameEnt)
		if lname == "recycle.bin" || lname == "$recycle.bin" || lname == "my computer" || lname == "this pc" || lname == "darchi.exe" {
			continue
		}
		src := filepath.Join(srcDir, nameEnt)
		dst := filepath.Join(desktop, nameEnt)
		// if exists on desktop, remove it first to replace
		os.RemoveAll(dst)
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.IsDir() {
			if err := os.Rename(src, dst); err != nil {
				if err := copyDir(src, dst); err != nil {
					continue
				}
				os.RemoveAll(src)
			}
		} else {
			if err := os.Rename(src, dst); err != nil {
				if err := copyFile(src, dst); err != nil {
					continue
				}
				os.Remove(src)
			}
		}
	}
	// remove info.json and the archive folder if now empty
	os.Remove(infoPath)
	// remove filesDir if empty
	if entries2, err := os.ReadDir(srcDir); err == nil && len(entries2) == 0 {
		os.Remove(srcDir)
	}
	// remove archPath if empty
	if entries3, err := os.ReadDir(archPath); err == nil && len(entries3) == 0 {
		os.RemoveAll(archPath)
	}
	time.Sleep(300 * time.Millisecond)
	a.RestoreDesktopIconPositions(positions)
	return newName, nil
}

func (a *App) RevealInExplorer(path string) error {
	return a.OpenFileLocation(path)
}
