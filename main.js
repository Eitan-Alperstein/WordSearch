const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

class WordSearchGenerator {
    constructor() {
        this.gridSize = 15;
        // Allow right, down, down-right diagonal, up, and up-right diagonal
        this.directions = [
            [0, 1],   // right
            [1, 0],   // down
            [1, 1],   // down-right diagonal
            [-1, 0],  // up
            [-1, 1]   // up-right diagonal
        ];
    }

    createEmptyGrid() {
        return Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(''));
    }

    canPlaceWord(grid, word, row, col, direction) {
        const [dr, dc] = direction;
        
        for (let i = 0; i < word.length; i++) {
            const newRow = row + i * dr;
            const newCol = col + i * dc;
            
            if (newRow < 0 || newRow >= this.gridSize || 
                newCol < 0 || newCol >= this.gridSize) {
                return false;
            }
            
            const existingChar = grid[newRow][newCol];
            if (existingChar !== '' && existingChar !== word[i]) {
                return false;
            }
        }
        return true;
    }

    placeWord(grid, word, row, col, direction) {
        const [dr, dc] = direction;
        const positions = [];
        
        for (let i = 0; i < word.length; i++) {
            const newRow = row + i * dr;
            const newCol = col + i * dc;
            grid[newRow][newCol] = word[i];
            positions.push([newRow, newCol]);
        }
        
        return positions;
    }

    generatePuzzle(words) {
        const grid = this.createEmptyGrid();
        const placedWords = [];
        const maxAttempts = 100;

        for (const word of words) {
            const originalWord = word.trim();
            const gridWord = originalWord.replace(/\s+/g, '').toUpperCase();
            if (!gridWord) continue;
            
            let placed = false;
            
            for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
                const direction = this.directions[Math.floor(Math.random() * this.directions.length)];
                const row = Math.floor(Math.random() * this.gridSize);
                const col = Math.floor(Math.random() * this.gridSize);
                
                if (this.canPlaceWord(grid, gridWord, row, col, direction)) {
                    const positions = this.placeWord(grid, gridWord, row, col, direction);
                    placedWords.push({
                        word: originalWord,
                        gridWord: gridWord,
                        positions: positions
                    });
                    placed = true;
                }
            }
        }

        // Fill empty cells with random letters
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = 0; i < this.gridSize; i++) {
            for (let j = 0; j < this.gridSize; j++) {
                if (grid[i][j] === '') {
                    grid[i][j] = letters[Math.floor(Math.random() * letters.length)];
                }
            }
        }

        return { grid, placedWords };
    }

    async createPDF(puzzles, filename) {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const stream = fs.createWriteStream(filename);
            doc.pipe(stream);

            // Register CONSOLA.ttf (standard Windows Consolas font)
            const consolasPath = path.join(__dirname, 'fonts', 'CONSOLA.ttf');
            let consolasAvailable = false;
            if (fs.existsSync(consolasPath)) {
                try {
                    doc.registerFont('Consolas', consolasPath);
                    consolasAvailable = true;
                } catch (e) {
                    console.error('Failed to register CONSOLA.ttf:', e);
                }
            }

            // Add puzzles
            puzzles.forEach((puzzle, index) => {
                if (index > 0) doc.addPage();
                this.addPuzzlePage(doc, puzzle, index + 1, consolasAvailable);
            });

            // Add solutions
            puzzles.forEach((puzzle, index) => {
                doc.addPage();
                this.addSolutionPage(doc, puzzle, index + 1, consolasAvailable);
            });

            doc.end();
            
            stream.on('finish', () => resolve(filename));
            stream.on('error', reject);
        });
    }

    addPuzzlePage(doc, puzzle, pageNumber, consolasAvailable) {
        const { grid, placedWords } = puzzle;

        // Title at the top (header)
        doc.fontSize(24).font('Helvetica-Bold')
           .text(`Word Search #${pageNumber}`, { align: 'center' });

        doc.moveDown(1.5);

        // Center the grid horizontally on the page
        const cellSize = 25;
        const gridWidth = this.gridSize * cellSize;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const startX = doc.page.margins.left + Math.floor((pageWidth - gridWidth) / 2);
        const startY = doc.y;

        // Draw only the outer border of the grid
        doc.lineWidth(1.5)
           .rect(startX, startY, gridWidth, this.gridSize * cellSize)
           .stroke();

        // Draw letters inside the grid, no boxes, Consolas font if available, else Helvetica
        for (let i = 0; i < this.gridSize; i++) {
            for (let j = 0; j < this.gridSize; j++) {
                const x = startX + j * cellSize;
                const y = startY + i * cellSize;
                doc.fontSize(14).font(consolasAvailable ? 'Consolas' : 'Helvetica')
                   .text(grid[i][j], x + cellSize/2 - 6, y + cellSize/2 - 9, { width: 12, align: 'center' });
            }
        }

        // Word list below the grid in 3 columns, no bullets, no heading, centered, Consolas font
        const wordListY = startY + (this.gridSize * cellSize) + 30;
        // Calculate column layout
        const columnWidth = gridWidth / 3;
        const wordsPerColumn = Math.ceil(placedWords.length / 3);

        doc.fontSize(12).font(consolasAvailable ? 'Consolas' : 'Helvetica');
        placedWords.forEach((wordInfo, index) => {
            const column = Math.floor(index / wordsPerColumn);
            const rowInColumn = index % wordsPerColumn;

            const x = startX + (column * columnWidth);
            const y = wordListY + (rowInColumn * 18);

            // No bullet, just the word, Consolas font if available, else Helvetica
            const maxWidth = columnWidth - 10;
            doc.text(`${wordInfo.word}`, x, y, {
                width: maxWidth,
                align: 'center',
                lineBreak: true
            });
        });
    }

    addSolutionPage(doc, puzzle, pageNumber, consolasAvailable) {
        const { grid, placedWords } = puzzle;

        // Use sans-serif font for title
        doc.fontSize(24).font('Helvetica-Bold')
           .text(`Solution #${pageNumber}`, { align: 'center' });

        doc.moveDown(1.5);

        // Center the grid horizontally on the page
        const cellSize = 25;
        const gridWidth = this.gridSize * cellSize;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const startX = doc.page.margins.left + Math.floor((pageWidth - gridWidth) / 2);
        const startY = doc.y;

        // Draw only the outer border of the grid
        doc.lineWidth(1.5)
           .rect(startX, startY, gridWidth, this.gridSize * cellSize)
           .stroke();

        // Draw letters inside the grid, no boxes, Consolas font if available, else Helvetica
        for (let i = 0; i < this.gridSize; i++) {
            for (let j = 0; j < this.gridSize; j++) {
                const x = startX + j * cellSize;
                const y = startY + i * cellSize;
                doc.fillColor('black').fontSize(14).font(consolasAvailable ? 'Consolas' : 'Helvetica')
                   .text(grid[i][j], x + cellSize/2 - 6, y + cellSize/2 - 9, { width: 12, align: 'center' });
            }
        }

        // Draw solution lines over the grid
        placedWords.forEach(wordInfo => {
            if (wordInfo.positions.length < 2) return;

            const firstPos = wordInfo.positions[0];
            const lastPos = wordInfo.positions[wordInfo.positions.length - 1];

            const x1 = startX + firstPos[1] * cellSize + cellSize/2;
            const y1 = startY + firstPos[0] * cellSize + cellSize/2;
            const x2 = startX + lastPos[1] * cellSize + cellSize/2;
            const y2 = startY + lastPos[0] * cellSize + cellSize/2;

            // Draw thick rounded line
            doc.save()
               .strokeColor('#808080')
               .strokeOpacity(0.7)
               .lineWidth(8)
               .lineCap('round')
               .moveTo(x1, y1)
               .lineTo(x2, y2)
               .stroke()
               .restore();
        });

        // Word list below the grid in 3 columns, no bullets, no heading, centered, Consolas font
        const wordListY = startY + (this.gridSize * cellSize) + 30;
        // Calculate column layout
        const columnWidth = gridWidth / 3;
        const wordsPerColumn = Math.ceil(placedWords.length / 3);

        doc.fontSize(12).font(consolasAvailable ? 'Consolas' : 'Helvetica');
        placedWords.forEach((wordInfo, index) => {
            const column = Math.floor(index / wordsPerColumn);
            const rowInColumn = index % wordsPerColumn;

            const x = startX + (column * columnWidth);
            const y = wordListY + (rowInColumn * 18);

            // No bullet, just the word, Consolas font if available, else Helvetica
            const maxWidth = columnWidth - 10;
            doc.text(`${wordInfo.word}`, x, y, {
                width: maxWidth,
                align: 'center',
                lineBreak: true
            });
        });
    }
}

let mainWindow;
const generator = new WordSearchGenerator();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        icon: path.join(__dirname, 'logo.png')
    });

    mainWindow.loadFile('index.html');
    
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC Handlers
ipcMain.handle('generate-puzzles', async (event, config) => {
    try {
        const { numPuzzles, wordsPerPuzzle, separator, wordInput } = config;
        
        const puzzleGroups = wordInput.split(separator).map(group => 
            group.trim().split(',').map(word => word.trim()).filter(word => word.length > 0)
        );

        const puzzles = [];
        for (let i = 0; i < Math.min(numPuzzles, puzzleGroups.length); i++) {
            const words = puzzleGroups[i].slice(0, wordsPerPuzzle);
            const puzzle = generator.generatePuzzle(words);
            puzzles.push(puzzle);
        }

        const filename = path.join(__dirname, 'temp', `puzzles-${Date.now()}.pdf`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(filename);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        await generator.createPDF(puzzles, filename);
        
        return { success: true, filename, puzzles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-pdf-as', async (event, currentFilename) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: 'word-search-puzzles.pdf',
            filters: [
                { name: 'PDF Files', extensions: ['pdf'] }
            ]
        });

        if (!result.canceled) {
            fs.copyFileSync(currentFilename, result.filePath);
            return { success: true, filePath: result.filePath };
        }
        
        return { success: false, canceled: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// index.html - Main UI
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Word Search Generator</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            overflow: hidden;
        }

        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: url('data:image/svg+xml,<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd"><g fill="%23ffffff" fill-opacity="0.05"><circle cx="30" cy="30" r="1"/></g></svg>');
            pointer-events: none;
        }

        .container {
            display: flex;
            height: 100vh;
        }

        .sidebar {
            width: 400px;
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(25px);
            border-right: 1px solid rgba(255, 255, 255, 0.2);
            padding: 2rem;
            overflow-y: auto;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }

        .main-content {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(15px);
            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 2rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .header h1 {
            color: white;
            font-size: 2.5rem;
            font-weight: 300;
            margin-bottom: 0.5rem;
        }

        .header p {
            color: rgba(255, 255, 255, 0.8);
            font-size: 1.1rem;
        }

        .form-group {
            margin-bottom: 1.5rem;
        }

        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.9);
        }

        .form-control {
            width: 100%;
            padding: 0.75rem;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
        }

        .form-control:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        textarea.form-control {
            min-height: 120px;
            resize: vertical;
        }

        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            width: 100%;
            margin-bottom: 1rem;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-secondary {
            background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
            color: #333;
        }

        .btn-secondary:hover {
            box-shadow: 0 10px 25px rgba(252, 182, 159, 0.3);
        }

        .pdf-viewer {
            flex: 1;
            padding: 2rem;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .pdf-container {
            width: 100%;
            height: 100%;
            background: white;
            border-radius: 12px;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .pdf-toolbar {
            background: #f8f9fa;
            padding: 1rem;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pdf-content {
            flex: 1;
            position: relative;
            overflow: hidden;
        }

        .pdf-embed {
            width: 100%;
            height: 100%;
            border: none;
        }

        .loading-spinner {
            display: none;
            text-align: center;
            padding: 2rem;
            color: #667eea;
        }

        .loading-spinner.active {
            display: block;
        }

        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid #e1e5e9;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            color: rgba(255, 255, 255, 0.6);
            padding: 4rem 2rem;
        }

        .empty-state h3 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            font-weight: 300;
        }

        .empty-state p {
            font-size: 1.1rem;
            line-height: 1.6;
        }

        .stats {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
        }

        .stats h4 {
            color: rgba(255, 255, 255, 0.9);
            margin-bottom: 0.5rem;
        }

        .stats p {
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.9rem;
            margin-bottom: 0.25rem;
        }

        .error-message {
            background: #ffe6e6;
            color: #d63031;
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1rem;
            border-left: 4px solid #d63031;
        }

        .success-message {
            background: #e8f5e8;
            color: #00b894;
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1rem;
            border-left: 4px solid #00b894;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <h2 style="margin-bottom: 2rem; color: rgba(255, 255, 255, 0.9);">Puzzle Settings</h2>
            
            <div id="messages"></div>
            
            <form id="puzzleForm">
                <div class="form-group">
                    <label for="numPuzzles">Number of Puzzles</label>
                    <input type="number" id="numPuzzles" class="form-control" value="2" min="1" max="20">
                </div>
                
                <div class="form-group">
                    <label for="wordsPerPuzzle">Words per Puzzle</label>
                    <input type="number" id="wordsPerPuzzle" class="form-control" value="8" min="1" max="15">
                </div>
                
                <div class="form-group">
                    <label for="separator">Page Separator</label>
                    <input type="text" id="separator" class="form-control" value="|" placeholder="e.g., |, ---, NEXT">
                </div>
                
                <div class="form-group">
                    <label for="wordInput">Word List</label>
                    <textarea id="wordInput" class="form-control" placeholder="Enter words separated by commas. Use separator to create new puzzles.&#10;&#10;Example:&#10;cat, dog, bird, fish, mouse, elephant | apple, banana, orange, grape, cherry, strawberry"></textarea>
                </div>
                
                <button type="submit" class="btn" id="generateBtn">
                    Generate Puzzles
                </button>
                
                <button type="button" class="btn btn-secondary" id="saveBtn" style="display: none;">
                    Save PDF As...
                </button>
            </form>
            
            <div class="stats" id="puzzleStats" style="display: none;">
                <h4>Generation Summary</h4>
                <p id="statsText"></p>
            </div>
        </div>
        
        <div class="main-content">
            <div class="header">
                <h1>Word Search Generator</h1>
                <p>Create beautiful PDF word search puzzles with solutions</p>
            </div>
            
            <div class="pdf-viewer">
                <div id="emptyState" class="empty-state">
                    <h3>Ready to Generate</h3>
                    <p>Fill in your puzzle settings and word list to create amazing word search puzzles. Your PDF will appear here with a built-in viewer.</p>
                </div>
                
                <div id="loadingState" class="loading-spinner">
                    <div class="spinner"></div>
                    <p>Generating your puzzles...</p>
                </div>
                
                <div id="pdfContainer" class="pdf-container" style="display: none;">
                    <div class="pdf-toolbar">
                        <span id="pdfTitle">Word Search Puzzles</span>
                        <button class="btn btn-secondary" id="openExternalBtn" style="padding: 0.5rem 1rem; width: auto;">
                            Open in PDF Viewer
                        </button>
                    </div>
                    <div class="pdf-content">
                        <embed id="pdfEmbed" class="pdf-embed" type="application/pdf">
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const { ipcRenderer, shell } = require('electron');
        
        let currentPdfPath = null;
        
        document.getElementById('puzzleForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const config = {
                numPuzzles: parseInt(document.getElementById('numPuzzles').value),
                wordsPerPuzzle: parseInt(document.getElementById('wordsPerPuzzle').value),
                separator: document.getElementById('separator').value,
                wordInput: document.getElementById('wordInput').value.trim()
            };
            
            if (!config.wordInput) {
                showMessage('Please enter some words for the puzzle.', 'error');
                return;
            }
            
            showLoading(true);
            clearMessages();
            
            try {
                const result = await ipcRenderer.invoke('generate-puzzles', config);
                
                if (result.success) {
                    currentPdfPath = result.filename;
                    showPdf(result.filename);
                    showStats(result.puzzles, config);
                    showMessage('Puzzles generated successfully!', 'success');
                    document.getElementById('saveBtn').style.display = 'block';
                } else {
                    showMessage(\`Error: \${result.error}\`, 'error');
                }
            } catch (error) {
                showMessage(\`Unexpected error: \${error.message}\`, 'error');
            } finally {
                showLoading(false);
            }
        });
        
        document.getElementById('saveBtn').addEventListener('click', async () => {
            if (!currentPdfPath) return;
            
            try {
                const result = await ipcRenderer.invoke('save-pdf-as', currentPdfPath);
                
                if (result.success && !result.canceled) {
                    showMessage(\`PDF saved to: \${result.filePath}\`, 'success');
                }
            } catch (error) {
                showMessage(\`Error saving PDF: \${error.message}\`, 'error');
            }
        });
        
        document.getElementById('openExternalBtn').addEventListener('click', () => {
            if (currentPdfPath) {
                shell.openPath(currentPdfPath);
            }
        });
        
        function showLoading(show) {
            document.getElementById('loadingState').classList.toggle('active', show);
            document.getElementById('generateBtn').disabled = show;
            
            if (show) {
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('pdfContainer').style.display = 'none';
            }
        }
        
        function showPdf(filename) {
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('pdfContainer').style.display = 'flex';
            document.getElementById('pdfEmbed').src = filename;
        }
        
        function showStats(puzzles, config) {
            const statsElement = document.getElementById('puzzleStats');
            const statsText = document.getElementById('statsText');
            
            let totalWords = 0;
            puzzles.forEach(puzzle => {
                totalWords += puzzle.placedWords.length;
            });
            
            statsText.innerHTML = \`
                <strong>\${puzzles.length}</strong> puzzle(s) created<br>
                <strong>\${totalWords}</strong> words placed successfully<br>
                Grid size: <strong>15x15</strong><br>
                Pages: <strong>\${puzzles.length * 2}</strong> (puzzles + solutions)
            \`;
            
            statsElement.style.display = 'block';
        }
        
        function showMessage(message, type) {
            const messagesContainer = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
            messageDiv.textContent = message;
            messagesContainer.appendChild(messageDiv);
            
            setTimeout(() => {
                messageDiv.remove();
            }, 5000);
        }
        
        function clearMessages() {
            document.getElementById('messages').innerHTML = '';
        }
        
        // Example word list
        document.getElementById('wordInput').value = 'cat, dog, bird, fish, mouse, elephant, tiger, lion | apple, banana, orange, grape, cherry, strawberry, peach, mango';
    </script>
</body>
</html>`;

// Write the HTML file
require('fs').writeFileSync(path.join(__dirname, 'index.html'), htmlContent);

console.log('Word Search Desktop App files created!');
console.log('\\nTo run the application:');
console.log('1. npm install');
console.log('2. npm start');
console.log('\\nTo build for distribution:');
console.log('npm run build');
