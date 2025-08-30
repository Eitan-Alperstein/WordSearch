// IPC handler to generate word list from category using Llama
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');


// Use ollama npm package directly for LLM word list generation (support both default and named exports)
let ollama = require('ollama');
if (ollama.default) ollama = ollama.default;

ipcMain.handle('generate-word-list', async (event, { category, wordsPerPuzzle }) => {
    try {
        const promptTemplate = fs.readFileSync(path.join(__dirname, 'ollama-prompt.txt'), 'utf8');
        const separator = '|';
        let puzzles = [];
        let wordList = '';
        const topics = category.split(',').map(t => t.trim());
        const numPuzzles = topics.length; // Use number of topics as number of puzzles
        
        event.sender.send('ollama-wordlist-stream', { 
            type: 'progress',
            total: numPuzzles,
            current: 0,
            status: 'Starting word list generation...',
            phase: 'init'
        });

        // Process all puzzles in parallel
        const puzzlePromises = Array(numPuzzles).fill().map(async (_, i) => {
            try {
                event.sender.send('ollama-wordlist-stream', {
                    type: 'progress',
                    total: numPuzzles,
                    current: i,
                    status: `Generating puzzle ${i + 1}/${numPuzzles} (${topics[i]})...`,
                    phase: 'generating'
                });

                // Generate words for this puzzle
                const prompt = promptTemplate
                    .replace(/{{category}}/g, topics[i])
                    .replace(/{{wordsPerPuzzle}}/g, wordsPerPuzzle);

                const result = await ollama.generate({
                    model: 'llama3.2',
                    prompt,
                    stream: false,
                    options: { temperature: 0.3 }
                });

                // Parse words from response
                const line = result.response.trim().split('\n').find(l => l.includes(',')) || result.response.trim();
                const words = line.split(',')
                    .map(w => w.trim())
                    .filter(w => w.length > 0)
                    .slice(0, wordsPerPuzzle);

                event.sender.send('ollama-wordlist-stream', {
                    type: 'progress',
                    total: numPuzzles,
                    current: i + 1,
                    status: `Completed puzzle ${i + 1}/${numPuzzles}`,
                    phase: 'completed'
                });

                return { index: i, words };
            } catch (error) {
                event.sender.send('ollama-wordlist-stream', {
                    type: 'error',
                    puzzleIndex: i,
                    error: error.message
                });
                throw error;
            }
        });

        // Wait for all puzzles to complete
        const results = await Promise.allSettled(puzzlePromises);
        const successfulResults = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value)
            .sort((a, b) => a.index - b.index);

        if (successfulResults.length === 0) {
            throw new Error('Failed to generate any puzzles. Please try again.');
        }

        // Build final word list
        for (const { words } of successfulResults) {
            puzzles.push(words);
            wordList += (wordList ? separator : '') + words.join(',');
        }

        event.sender.send('ollama-wordlist-stream', { type: 'end', data: wordList });
        return { success: true, wordList };
    } catch (error) {
        event.sender.send('ollama-wordlist-stream', { type: 'error', error: error.message });
        return { success: false, error: error.message };
    }
});

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
        const { wordsPerPuzzle, separator, wordInput } = config;
        
        // Count topics to determine number of puzzles
        const numPuzzles = (wordInput.match(/,/g) || []).length + 1;
        
        const puzzleGroups = wordInput.split(separator).map(group => 
            group.trim().split(',').map(word => word.trim()).filter(word => word.length > 0)
        );

        const puzzles = [];
        // Cycle through puzzle groups if we need more puzzles than we have groups
        for (let i = 0; i < numPuzzles; i++) {
            const groupIndex = i % puzzleGroups.length; // Cycle through groups
            const words = puzzleGroups[groupIndex].slice(0, wordsPerPuzzle);
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


console.log('Word Search Desktop App files created!');
console.log('\\nTo run the application:');
console.log('1. npm install');
console.log('2. npm start');
console.log('\\nTo build for distribution:');
console.log('npm run build');
