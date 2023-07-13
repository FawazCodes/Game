const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const net = require('net');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = [];
let numbers = {};
let turn = null;
let playerReadyCount = 0;
let gameInProgress = false;

const WAITING_PERIOD = 5000; // 5 seconds waiting period
let waitingForPlayers = false;
let waitingTimer;

function resetGameState() {
  players = [];
  numbers = {};
  turn = null;
  playerReadyCount = 0;
  gameInProgress = false;
}

io.on('connection', (socket) => {
  players.push({ id: socket.id, name: '' });
  io.emit('playerJoined', { playerCount: players.length });

  socket.on('playerReady', (data) => {
    try {
      if (gameInProgress) {
        return;
      }

      const player = players.find((player) => player.id === socket.id);
      if (player) {
        player.name = data.name;
      }

      playerReadyCount++;

      if (playerReadyCount >= 2) {
        clearTimeout(waitingTimer);
        waitingForPlayers = false;
        waitingMessage.style.display = 'none';
        playerIndicator.style.display = 'block';
        startGame();
      } else {
        waitingForPlayers = true;
        waitingMessage.textContent = 'Waiting for another player to join.';
        waitingMessage.style.display = 'block';
        playerIndicator.style.display = 'none';
      }
    } catch (error) {
      socket.emit('error', { message: 'An error occurred while processing your request.' });
    }
  });

  socket.on('submitNumber', (data) => {
    try {
      if (gameInProgress) {
        return;
      }

      numbers[socket.id] = data.number.split('');

      if (Object.keys(numbers).length === 2) {
        turn = Math.floor(Math.random() * 2);

        io.to(players[turn].id).emit('yourTurn');
        io.to(players[1 - turn].id).emit('opponentTurn', { name: players[turn].name });

        startGame();
      }
    } catch (error) {
      socket.emit('error', { message: 'An error occurred while processing your request.' });
    }
  });

  socket.on('makeGuess', (data) => {
    try {
      const currentPlayer = players[turn];

      if (socket.id !== currentPlayer.id) {
        return;
      }

      const opponentId = players.find((player) => player.id !== socket.id).id;
      const feedback = getFeedback(numbers[opponentId], data.guess.split(''));

      socket.emit('feedback', { feedback, guess: data.guess });
      socket.broadcast.emit('opponentGuess', { feedback, guess: data.guess, name: players.find((player) => player.id === socket.id).name });

      if (feedback === '++++') {
        socket.emit('win');
        socket.broadcast.emit('lose');
        endGame();
      } else {
        turn = 1 - turn;
        io.to(players[turn].id).emit('yourTurn');
        io.to(players[1 - turn].id).emit('opponentTurn', { name: players[turn].name });
      }
    } catch (error) {
      socket.emit('error', { message: 'An error occurred while processing your request.' });
    }
  });

  socket.on('disconnect', () => {
    try {
      players = players.filter((player) => player.id !== socket.id);
      delete numbers[socket.id];
      io.emit('playerLeft', { playerCount: players.length });

      if (players.length === 1 && gameInProgress) {
        endGame();
      } else if (players.length === 1 && waitingForPlayers) {
        clearTimeout(waitingTimer);
        waitingMessage.textContent = 'Not enough players. Please try again later.';
      }
    } catch (error) {
      socket.emit('error', { message: 'An error occurred while processing your request.' });
    }
  });

  socket.on('playAgain', () => {
    resetGameState();
    io.emit('playerJoined', { playerCount: players.length });
  });
});

function getFeedback(secretNumber, guessedNumber) {
  let positives = 0;
  let negatives = 0;

  secretNumber.forEach((digit, index) => {
    if (digit === guessedNumber[index]) {
      positives++;
    } else if (guessedNumber.includes(digit)) {
      negatives++;
    }
  });

  return `+${positives} -${negatives}`;
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const tester = net
      .createServer()
      .once('error', (err) => (err.code == 'EADDRINUSE' ? resolve(false) : reject(err)))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(port);
  });
}

async function getAvailablePort(startPort) {
  let port = startPort;
  while (!(await checkPort(port))) {
    port++;
  }
  return port;
}

function startGame() {
  gameInProgress = true;
  io.emit('guessStage');
}

function endGame() {
  gameInProgress = false;
  resetGameState();
}

getAvailablePort(3010).then((port) => {
  server.listen(port, () => {
    console.log('Server listening on port ' + port);
  });
});