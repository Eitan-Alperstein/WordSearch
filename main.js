const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

let ollama = require('ollama');
if (ollama.default) ollama = ollama.default;

let mainWindow;
let selectedCategory = '';
let generatedSubthemes = [];
let generatedPuzzles = [];
let testMode = process.argv.includes('--test');

// PHASE 1: Generate sub-themes using AI
ipcMain.handle('generate-subthemes', async (event, category) => {
    const targetCount = testMode ? 5 : 100;
    console.log(`\n=== GENERATING ${targetCount} SUB-THEMES FOR: ${category} ${testMode ? '(TEST MODE)' : ''} ===`);
    
    try {
        selectedCategory = category;
        let prompt = fs.readFileSync(path.join(__dirname, 'subtheme-prompt.txt'), 'utf8');
        prompt = prompt.replace('{CATEGORY}', category).replace('100', targetCount.toString());

        const result = await ollama.generate({
            model: 'llama3.2',
            prompt,
            stream: false,
            options: { temperature: 0.3 }
        });

        const subthemesText = result.response.trim();
        const subthemes = subthemesText.split(',').map(t => t.trim()).filter(t => t);
        
        console.log(`Generated ${subthemes.length} sub-themes:`, subthemes.slice(0, 10), '...');
        
        generatedSubthemes = subthemes.slice(0, targetCount);
        
        return { success: true, subthemes: generatedSubthemes };
        
    } catch (error) {
        console.error('Sub-theme generation failed:', error.message);
        return { success: false, error: error.message };
    }
});

// PHASE 2: Generate puzzles from sub-themes
ipcMain.handle('create-puzzles', async (event, category, subthemes) => {
    const targetCount = testMode ? 5 : 100;
    console.log(`\n=== GENERATING PUZZLES FROM SUB-THEMES ${testMode ? '(TEST MODE)' : ''} ===`);
    
    if (!subthemes || subthemes.length === 0) {
        return { success: false, error: 'No sub-themes available. Generate sub-themes first.' };
    }
    
    const promptTemplate = fs.readFileSync(path.join(__dirname, 'ollama-prompt.txt'), 'utf8');
    const puzzles = [];
    let successCount = 0;
    let skipCount = 0;
    
    for (let i = 0; i < subthemes.length; i++) {
        const subtheme = subthemes[i];
        const progress = i + 1;
        
        console.log(`\n--- ${progress}/${targetCount}: "${subtheme}" ---`);
        
        // Send progress update
        if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('puzzle-progress', {
                current: progress,
                total: targetCount,
                topic: subtheme,
                status: `Processing ${progress}/${targetCount}: ${subtheme}`
            });
        }
        
        try {
            // Generate words for this sub-theme
            const prompt = promptTemplate
                .replace(/{{category}}/g, `${category} - ${subtheme}`)
                .replace(/{{wordsPerPuzzle}}/g, 20);
            
            const result = await ollama.generate({
                model: 'llama3.2',
                prompt,
                stream: false,
                options: { temperature: 0.1 }
            });
            
            // Parse words
            const line = result.response.trim().split('\n').find(l => l.includes(',')) || result.response.trim();
            const allWords = line.split(',')
                .map(w => w.trim())
                .filter(w => {
                    if (w.includes(' ')) return false;
                    const isValid = /^[a-zA-Z]+$/.test(w) && w.length >= 3 && w.length <= 15;
                    return isValid;
                });
            
            const words = [...new Set(allWords)].slice(0, 15);
            
            if (words.length >= 10) {
                // Create puzzle
                const puzzle = createPuzzle(words, subtheme);
                puzzles.push(puzzle);
                successCount++;
                console.log(`✓ SUCCESS: ${words.length} words`);
            } else {
                skipCount++;
                console.log(`⚠ SKIPPED: Only ${words.length} words`);
            }
            
        } catch (error) {
            skipCount++;
            console.log(`⚠ SKIPPED: ${error.message}`);
        }
    }
    
    generatedPuzzles = puzzles;
    console.log(`\n=== COMPLETED: ${successCount} puzzles, ${skipCount} skipped ${testMode ? '(TEST MODE)' : ''} ===`);
    
    return { success: true, puzzles: puzzles, successCount, skipCount };
});

// PHASE 3: Create PDF
ipcMain.handle('create-pdf', async (event) => {
    console.log('\n=== CREATING PDF ===');
    
    if (generatedPuzzles.length === 0) {
        return { success: false, error: 'No puzzles available' };
    }
    
    try {
        const filename = path.join(__dirname, 'temp', `puzzles-${Date.now()}.pdf`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(filename);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        await createPDF(generatedPuzzles, filename);
        console.log(`PDF created: ${filename}`);
        
        return { success: true, filename };
        
    } catch (error) {
        console.error('PDF creation failed:', error.message);
        return { success: false, error: error.message };
    }
});

// Helper function to create a single puzzle
function createPuzzle(words, topic) {
    const gridSize = 15;
    const grid = Array(gridSize).fill().map(() => Array(gridSize).fill(''));
    const placedWords = [];
    
    const directions = [
        [0, 1],   // right
        [1, 0],   // down
        [1, 1],   // down-right
        [-1, 0],  // up
        [-1, 1]   // up-right
    ];
    
    // Place each word
    for (const word of words) {
        const gridWord = word.toUpperCase();
        let placed = false;
        
        for (let attempt = 0; attempt < 100 && !placed; attempt++) {
            const direction = directions[Math.floor(Math.random() * directions.length)];
            const row = Math.floor(Math.random() * gridSize);
            const col = Math.floor(Math.random() * gridSize);
            
            if (canPlaceWord(grid, gridWord, row, col, direction, gridSize)) {
                const positions = placeWord(grid, gridWord, row, col, direction);
                placedWords.push({ word, gridWord, positions });
                placed = true;
            }
        }
    }
    
    // Fill empty cells
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            if (grid[i][j] === '') {
                grid[i][j] = letters[Math.floor(Math.random() * letters.length)];
            }
        }
    }
    
    return { grid, placedWords, category: topic };
}

function canPlaceWord(grid, word, row, col, direction, gridSize) {
    const [dr, dc] = direction;
    
    for (let i = 0; i < word.length; i++) {
        const newRow = row + i * dr;
        const newCol = col + i * dc;
        
        if (newRow < 0 || newRow >= gridSize || newCol < 0 || newCol >= gridSize) {
            return false;
        }
        
        const existingChar = grid[newRow][newCol];
        if (existingChar !== '' && existingChar !== word[i]) {
            return false;
        }
    }
    return true;
}

function placeWord(grid, word, row, col, direction) {
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

async function createPDF(puzzles, filename) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filename);
        doc.pipe(stream);

        // Add puzzle pages
        puzzles.forEach((puzzle, index) => {
            if (index > 0) doc.addPage();
            addPuzzlePage(doc, puzzle, index + 1);
        });

        // Add solution pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage();
            addSolutionPage(doc, puzzle, index + 1);
        });

        doc.end();
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
    });
}

async function createPDFWithCover(puzzles, filename, coverImageBuffer) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const stream = fs.createWriteStream(filename);
        doc.pipe(stream);

        // Add cover page
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        doc.image(coverImageBuffer, 0, 0, { width: pageWidth, height: pageHeight });

        // Add puzzle pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addPuzzlePage(doc, puzzle, index + 1);
        });

        // Add solution pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addSolutionPage(doc, puzzle, index + 1);
        });

        doc.end();
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
    });
}

function addPuzzlePage(doc, puzzle, pageNumber) {
    const { grid, placedWords, category } = puzzle;
    const gridSize = 15;
    const cellSize = 25;

    // No title - start directly with grid
    doc.moveDown(2);

    // Grid
    const gridWidth = gridSize * cellSize;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left + Math.floor((pageWidth - gridWidth) / 2);
    const startY = doc.y;

    // Draw grid border
    doc.lineWidth(1.5)
       .rect(startX, startY, gridWidth, gridSize * cellSize)
       .stroke();

    // Draw letters
    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            const x = startX + j * cellSize;
            const y = startY + i * cellSize;
            const letter = grid[i][j];
            
            // Center each letter properly
            doc.fontSize(14).font('Helvetica');
            const letterWidth = doc.widthOfString(letter);
            const letterX = x + (cellSize - letterWidth) / 2;
            const letterY = y + cellSize/2 - 5;
            
            doc.text(letter, letterX, letterY);
        }
    }

    // Word list
    const wordListY = startY + (gridSize * cellSize) + 30;
    const columnWidth = gridWidth / 3;
    const wordsPerColumn = Math.ceil(placedWords.length / 3);

    doc.fontSize(12).font('Helvetica');
    placedWords.forEach((wordInfo, index) => {
        const column = Math.floor(index / wordsPerColumn);
        const rowInColumn = index % wordsPerColumn;
        const x = startX + (column * columnWidth);
        const y = wordListY + (rowInColumn * 18);
        doc.text(wordInfo.word, x, y, { width: columnWidth - 10, align: 'center' });
    });
}

function addSolutionPage(doc, puzzle, pageNumber) {
    const { grid, placedWords, category } = puzzle;
    const gridSize = 15;
    const cellSize = 25;

    // Solution title only
    doc.fontSize(20).font('Helvetica-Bold')
       .text('Solution', { align: 'center' });
    doc.moveDown(1.5);

    // Grid
    const gridWidth = gridSize * cellSize;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left + Math.floor((pageWidth - gridWidth) / 2);
    const startY = doc.y;

    // Draw grid border
    doc.lineWidth(1.5)
       .rect(startX, startY, gridWidth, gridSize * cellSize)
       .stroke();

    // Draw letters
    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            const x = startX + j * cellSize;
            const y = startY + i * cellSize;
            const letter = grid[i][j];
            
            // Center each letter properly
            doc.fontSize(14).font('Helvetica');
            const letterWidth = doc.widthOfString(letter);
            const letterX = x + (cellSize - letterWidth) / 2;
            const letterY = y + cellSize/2 - 5;
            
            doc.text(letter, letterX, letterY);
        }
    }

    // Draw solution lines
    placedWords.forEach(wordInfo => {
        if (wordInfo.positions.length < 2) return;
        const firstPos = wordInfo.positions[0];
        const lastPos = wordInfo.positions[wordInfo.positions.length - 1];
        const x1 = startX + firstPos[1] * cellSize + cellSize/2;
        const y1 = startY + firstPos[0] * cellSize + cellSize/2;
        const x2 = startX + lastPos[1] * cellSize + cellSize/2;
        const y2 = startY + lastPos[0] * cellSize + cellSize/2;

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

    // Word list
    const wordListY = startY + (gridSize * cellSize) + 30;
    const columnWidth = gridWidth / 3;
    const wordsPerColumn = Math.ceil(placedWords.length / 3);

    doc.fontSize(12).font('Helvetica');
    placedWords.forEach((wordInfo, index) => {
        const column = Math.floor(index / wordsPerColumn);
        const rowInColumn = index % wordsPerColumn;
        const x = startX + (column * columnWidth);
        const y = wordListY + (rowInColumn * 18);
        doc.text(wordInfo.word, x, y, { width: columnWidth - 10, align: 'center' });
    });
}

// Add cover to PDF
ipcMain.handle('add-cover-to-pdf', async (event, coverImageData) => {
    console.log('\n=== ADDING COVER TO PDF ===');
    
    if (generatedPuzzles.length === 0) {
        return { success: false, error: 'No puzzles available' };
    }
    
    try {
        const base64Data = coverImageData.replace(/^data:image\/png;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        const filename = path.join(__dirname, 'temp', `final-book-${Date.now()}.pdf`);
        
        const tempDir = path.dirname(filename);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        await createPDFWithCover(generatedPuzzles, filename, imageBuffer);
        console.log(`PDF with cover created: ${filename}`);
        
        return { success: true, filename };
        
    } catch (error) {
        console.error('Cover PDF creation failed:', error.message);
        return { success: false, error: error.message };
    }
});

async function createPDFWithCover(puzzles, filename, coverImageBuffer) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const stream = fs.createWriteStream(filename);
        doc.pipe(stream);

        // Add cover page
        doc.image(coverImageBuffer, 0, 0, { width: 595, height: 842 });
        
        // Add puzzle pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addPuzzlePage(doc, puzzle, index + 1);
        });

        // Add solution pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addSolutionPage(doc, puzzle, index + 1);
        });

        doc.end();
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
    });
}

// Save PDF dialog
ipcMain.handle('save-pdf-as', async (event, currentFilename) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: 'word-search-puzzles.pdf',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
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

// Navigate to cover designer
ipcMain.handle('open-cover-designer', async (event) => {
    mainWindow.loadFile('cover-designer.html');
    return { success: true };
});

// Electron app setup
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
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

// Check test mode handler
ipcMain.handle('check-test-mode', () => {
    return testMode;
});

// Cover design and final PDF creation
let coverData = null;

ipcMain.handle('create-final-pdf', async (event, cover) => {
    try {
        coverData = cover;
        const finalFilename = path.join(__dirname, 'temp', `final-book-${Date.now()}.pdf`);
        
        await createFinalPDFWithCover(generatedPuzzles, coverData, finalFilename);
        
        return { success: true, filename: finalFilename };
    } catch (error) {
        console.error('Final PDF creation failed:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-final-pdf-path', () => {
    const finalFiles = fs.readdirSync(path.join(__dirname, 'temp'))
        .filter(f => f.startsWith('final-book-'))
        .sort((a, b) => b.localeCompare(a));
    
    if (finalFiles.length > 0) {
        return { success: true, path: path.join(__dirname, 'temp', finalFiles[0]) };
    }
    return { success: false, error: 'No final PDF found' };
});

async function createFinalPDFWithCover(puzzles, cover, filename) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const stream = fs.createWriteStream(filename);
        doc.pipe(stream);

        // Add cover page
        addCoverPage(doc, cover);
        
        // Add puzzle pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addPuzzlePage(doc, puzzle, index + 1);
        });

        // Add solution pages
        puzzles.forEach((puzzle, index) => {
            doc.addPage({ margin: 50 });
            addSolutionPage(doc, puzzle, index + 1);
        });

        doc.end();
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
    });
}

function addCoverPage(doc, cover) {
    // Set page to full A4 size
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    
    cover.elements.forEach(el => {
        doc.save();
        doc.opacity(el.opacity || 1);
        
        if (el.type === 'rectangle') {
            if (el.cornerRadius > 0) {
                // Rounded rectangle
                const x = el.x, y = el.y, w = el.width, h = el.height, r = el.cornerRadius;
                doc.moveTo(x + r, y)
                   .lineTo(x + w - r, y)
                   .quadraticCurveTo(x + w, y, x + w, y + r)
                   .lineTo(x + w, y + h - r)
                   .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
                   .lineTo(x + r, y + h)
                   .quadraticCurveTo(x, y + h, x, y + h - r)
                   .lineTo(x, y + r)
                   .quadraticCurveTo(x, y, x + r, y)
                   .closePath();
            } else {
                doc.rect(el.x, el.y, el.width, el.height);
            }
            
            if (el.fillColor) {
                doc.fillColor(el.fillColor).fill();
            }
            
            if (el.borderWidth > 0 && el.borderColor) {
                doc.strokeColor(el.borderColor).lineWidth(el.borderWidth).stroke();
            }
        } else if (el.type === 'circle') {
            doc.circle(el.x + el.width/2, el.y + el.height/2, Math.min(el.width, el.height)/2);
            
            if (el.fillColor) {
                doc.fillColor(el.fillColor).fill();
            }
            
            if (el.borderWidth > 0 && el.borderColor) {
                doc.strokeColor(el.borderColor).lineWidth(el.borderWidth).stroke();
            }
        } else if (el.type === 'text') {
            doc.fontSize(el.fontSize || 24)
               .font(el.fontFamily || 'Helvetica')
               .fillColor(el.fillColor || '#000000')
               .text(el.text, el.x, el.y, { width: el.width });
        } else if (el.type === 'image' && el.image) {
            // Convert base64 to buffer for PDFKit
            const base64Data = el.image.replace(/^data:image\/[a-z]+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            doc.image(imageBuffer, el.x, el.y, { width: el.width, height: el.height });
        }
        
        doc.restore();
    });
}

console.log(`Word Search Generator Ready! ${testMode ? '*** TEST MODE ACTIVE ***' : ''}`);
if (testMode) {
    console.log('*** TEST MODE: Will generate only 5 puzzles instead of 100 ***');
}