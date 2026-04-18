/**
 * Stealth System Monitor - Node.js Version
 * Direct port of system_monitor.py with identical functionality
 * 
 * Features:
 * - Hold INSERT: Screenshot + Show Answer (blocks native Insert)
 * - DELETE: Clear current answer
 * - Ctrl+INSERT: Copy answer to clipboard
 * - F8 or Ctrl+Alt+Q: Quit application
 */


//Clear-History code
//Remove-Item (Get-PSReadLineOption).HistorySavePath

const { GoogleGenerativeAI } = require('@google/generative-ai');
const screenshot = require('screenshot-desktop');
const { globalShortcut, app, BrowserWindow, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { uIOhook, UiohookKey } = require('uiohook-napi');

// Multiple API keys for automatic fallback when quota is exceeded
const API_KEYS = [
    "1AQ.Ab8RN6Lz1VD-A6nFUV_EdrJ70W_MjM11C2ai9o4oM1HxplvQuA",
    "2AQ.Ab8RN6JJJ5IbpqMkXOXTmkvYKnx-DSpNNhG1f9kToPm9K2rzyA",
    "AQ.Ab8RN6JJJ5IbpqMkXOXTmkvYKnx-DSpNNhG1f9kToPm9K2rzyA",
    "4AQ.Ab8RN6KbMC_Gn5Vs9HsiuwU8dCRPYIsHCiqYifmM6_HkfRDC2A"
];

// 3AQ.Ab8RN6JPXcUrGYGGlwKdZOjoMBEBowTS6fVxJ9tqOjsWDN8uvQ
// 4AQ.Ab8RN6L36aLdJixBGf70SWhHCDHW1tlp43SEHJkMfwRxH1rpkw
// 5AQ.Ab8RN6I2WnuP0ibFdYhw_PvFulMeaXScDgkesYslnvjbeImpWA
// 6AQ.Ab8RN6Jg0Cskg5kRlRYkiy4wk4H1uhxkpdEOUmrLzSVFiaIXIw

let currentKeyIndex = 0;
let API_KEY = API_KEYS[currentKeyIndex];

if (!API_KEY || API_KEYS.length === 0) {
    console.error("No API Keys found");
    process.exit(1);
}

// Configure Gemini
let genAI;
let model;

try {
    genAI = new GoogleGenerativeAI(API_KEY);
} catch (error) {
    console.error(`Fatal error configuring Gemini: ${error.message}`);
    process.exit(1);
}

// Model priority list (fallback mechanism)
const MODEL_PRIORITY_LIST = [
    'gemini-2.5-flash'
];

// Global variables
let storedAnswer = null;
let answerWindow = null;
let isProcessing = false;
let insertKeyPressed = false;

class SystemMonitor {
    constructor() {
        this.init();
    }

    switchToNextApiKey() {
        if (API_KEYS.length === 0) {
            throw new Error("No API Keys found");
        }

        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        API_KEY = API_KEYS[currentKeyIndex];
        genAI = new GoogleGenerativeAI(API_KEY);
        console.log(`Switched to API key #${currentKeyIndex + 1}`);
    }

    async init() {
        await app.whenReady();
        this.setupWindows();
        this.setupHotkeys();
        this.hideFromTaskbar();
        
        console.log("--- STEALTH MODE ACTIVATED ---");
        console.log("1. Hold 'INSERT': Screenshot + Show Answer (Native Insert BLOCKED)");
        console.log("2. Press 'DELETE': Clear current answer");
        console.log("3. Press 'Ctrl+INSERT': Copy answer");
        console.log("4. Press 'F8' or 'Ctrl+Alt+Q': QUIT");
    }

    setupWindows() {
        // Create hidden main window (equivalent to Python's root.withdraw())
        const mainWindow = new BrowserWindow({
            width: 1,
            height: 1,
            show: false,
            skipTaskbar: true,
            frame: false
        });

        // Answer window (created on demand, like Python's Toplevel)
        answerWindow = null;
    }

    hideFromTaskbar() {
        // Hide from dock on macOS
        if (process.platform === 'darwin') {
            app.dock.hide();
        }
    }

    setupHotkeys() {
        // Use uIOhook for low-level keyboard hooks (like Python's keyboard library)
        
        // INSERT key - Hold logic with suppression
        let insertHoldTimer = null;
        
        uIOhook.on('keydown', (e) => {
            // INSERT key
            if (e.keycode === UiohookKey.Insert) {
                // Check if Ctrl is pressed (for Ctrl+Insert)
                if (e.ctrlKey) {
                    this.onCopy();
                    return;
                }
                
                if (!insertKeyPressed) {
                    insertKeyPressed = true;
                    
                    // On Key Down
                    if (!storedAnswer && !isProcessing) {
                        console.log("Insert pressed - Starting new scan...");
                        this.startProcessingThread();
                    }
                    this.showAnswerWindow();
                }
            }
            
            // DELETE key
            if (e.keycode === UiohookKey.Delete) {
                this.clearAnswer();
            }
            
            // F8 key
            if (e.keycode === UiohookKey.F8) {
                this.quitApp();
            }
        });

        uIOhook.on('keyup', (e) => {
            // INSERT key release
            if (e.keycode === UiohookKey.Insert) {
                insertKeyPressed = false;
                this.hideAnswerWindow();
            }
        });

        // Start the hook
        uIOhook.start();

        // Ctrl+Alt+Q using Electron's globalShortcut
        globalShortcut.register('CommandOrControl+Alt+Q', () => {
            this.quitApp();
        });

        // Ctrl+Insert (backup registration)
        globalShortcut.register('CommandOrControl+Insert', () => {
            this.onCopy();
        });
    }

    async getAnswerFromGemini(screenshotPath, prompt) {
        let lastError = "";

        // Read image once and reuse for all model/key attempts
        const imageBuffer = fs.readFileSync(screenshotPath);
        const base64Image = imageBuffer.toString('base64');
        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/png"
            }
        };

        for (const modelName of MODEL_PRIORITY_LIST) {
            // Try each API key exactly once per model, continuously rotating.
            for (let keyAttempt = 0; keyAttempt < API_KEYS.length; keyAttempt++) {
                const activeKeyNumber = currentKeyIndex + 1;
                console.log(`Trying model: ${modelName} with API key #${activeKeyNumber}...`);
                storedAnswer = `Scanning...\n(${modelName}, key ${activeKeyNumber})`;

                try {
                    model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent([prompt, imagePart]);
                    const response = await result.response;
                    const text = response.text();

                    if (text) {
                        console.log(`Success with ${modelName} using API key #${activeKeyNumber}`);
                        return text.trim();
                    }
                } catch (error) {
                    const errorStr = error.message || String(error);
                    lastError = errorStr;
                    console.log(`Error with ${modelName} on API key #${activeKeyNumber}: ${errorStr}`);

                    // On any failure, switch to next key. Last key wraps to first.
                    this.switchToNextApiKey();
                }
            }

            console.log(`All API keys failed for ${modelName}. Moving to next model...`);
        }

        return `Error: ${lastError || 'All models failed'}`;
    }

    async processScreenAndGetAnswer() {
        if (isProcessing) {
            return;
        }

        isProcessing = true;
        storedAnswer = "Scanning..."; // Clear previous answer immediately

        try {
            console.log("Capturing screen...");
            const imgBuffer = await screenshot();

            // Save screenshot
            const tempFile = path.join(__dirname, 'debug_last_capture.png');
            fs.writeFileSync(tempFile, imgBuffer);
            console.log("Screenshot saved");

            console.log("Analyzing...");

            const prompt = `Look at the image and analyze what is being asked.

IMPORTANT RULES:

1. **For Multiple Choice Questions (MCQ)**:
   - Return ONLY the letter of the correct answer (A, B, C, or D)
   - Do NOT return the full text of the option
   - Do NOT add any explanation
   - Example: If option B is correct, return: B

2. **For Programming/Coding Questions**:
   - Provide the COMPLETE, WORKING code solution without comments
   - Include ALL necessary code, not just a summary
   - Write clean, ready-to-use code without comments or explanations
   - Do NOT truncate or summarize the code
   - The code should be copy-paste ready

3. **For Text/Theory Questions**:
   - Provide a concise but complete answer
   - Include all key points needed to answer the question

4. **For Math/Calculation Questions**:
   - Provide the final answer with any necessary steps

CRITICAL: For code questions, provide the FULL working solution, not a description or summary!
`;

            const answer = await this.getAnswerFromGemini(tempFile, prompt);

            // Clean up answer
            let cleanedAnswer = answer;
            const prefixes = ["Answer:", "answer:", "**Answer:**"];
            for (const prefix of prefixes) {
                if (cleanedAnswer.includes(prefix)) {
                    cleanedAnswer = cleanedAnswer.split(prefix).pop().trim();
                }
            }

            storedAnswer = cleanedAnswer;
            console.log(`Stored: ${storedAnswer}`);

            // Copy to clipboard
            try {
                clipboard.writeText(storedAnswer);
                console.log("Copied to clipboard");
            } catch (error) {
                console.error("Clipboard error:", error);
            }

        } catch (error) {
            console.error(`Capture error: ${error.message}`);
            storedAnswer = `Error: ${error.message}`;
        } finally {
            isProcessing = false;
        }
    }

    startProcessingThread() {
        // Run in background (equivalent to Python's threading.Thread)
        this.processScreenAndGetAnswer();
    }

    showAnswerWindow() {
        if (!storedAnswer || storedAnswer.startsWith("Scanning")) {
            // Don't show window if no answer or still scanning
            return;
        }

        // Update clipboard
        try {
            clipboard.writeText(storedAnswer);
        } catch (error) {
            console.error("Clipboard error:", error);
        }

        // If window exists, update its content
        if (answerWindow && !answerWindow.isDestroyed()) {
            answerWindow.webContents.send('update-answer', storedAnswer);
            answerWindow.show();
            answerWindow.setAlwaysOnTop(true, 'screen-saver');
            return;
        }

        // Get screen dimensions
        const { screen } = require('electron');
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;

        // Small, subtle window - bottom right corner
        const w = 80;
        const h = 50;
        const x = screenWidth - w - 20;  // 20px from right edge
        const y = screenHeight - h - 60; // 60px from bottom (above taskbar)

        answerWindow = new BrowserWindow({
            width: w,
            height: h,
            x: x,
            y: y,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        answerWindow.setIgnoreMouseEvents(true);
        answerWindow.setAlwaysOnTop(true, 'screen-saver');

        // Load HTML content
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            font-family: Arial, sans-serif;
            font-size: 10px;
            color: #404040;
            text-align: center;
        }
        #answer {
            padding: 5px;
        }
    </style>
</head>
<body>
    <div id="answer">${storedAnswer}</div>
    <script>
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('update-answer', (event, text) => {
            document.getElementById('answer').textContent = text;
        });
    </script>
</body>
</html>
`;

        answerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        answerWindow.show();
    }

    hideAnswerWindow() {
        if (answerWindow && !answerWindow.isDestroyed()) {
            answerWindow.hide();
        }
    }

    clearAnswer() {
        storedAnswer = null;
        console.log("Answer Cleared. Next INSERT will capture.");
    }

    onCopy() {
        console.log("Ctrl+Insert: Copying...");
        try {
            clipboard.writeText(storedAnswer || "");
        } catch (error) {
            console.error("Clipboard error:", error);
        }
    }

    quitApp() {
        console.log("Exiting application...");
        
        // Stop uIOhook
        try {
            uIOhook.stop();
        } catch (error) {
            console.error("Error stopping uIOhook:", error);
        }

        // Unregister all shortcuts
        globalShortcut.unregisterAll();

        // Cleanup windows
        if (answerWindow && !answerWindow.isDestroyed()) {
            answerWindow.close();
        }

        app.quit();
        process.exit(0);
    }
}

// Disable hardware acceleration for stealth
app.disableHardwareAcceleration();

// Initialize when ready
app.whenReady().then(() => {
    new SystemMonitor();
});

// Keep running even when all windows are closed
app.on('window-all-closed', () => {
    // Don't quit
});

// Cleanup on quit
app.on('before-quit', () => {
    try {
        uIOhook.stop();
    } catch (error) {
        console.error("Error stopping uIOhook:", error);
    }
    globalShortcut.unregisterAll();
});
