// Setup basic express server
var express = require('express');
var app = express();
var path = require('path');
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(path.join(__dirname, 'public')));

// Chatroom

var numUsers = 0;
var players = []; // Array to track connected players: {socketId, username}
var roleSelections = {}; // Object to track role selections: {username: role}

// Function to shuffle array (Fisher-Yates shuffle)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Function to assign roles randomly from selected roles
function assignRoles(selectedRoles, targetPlayers) {
  // Filter players to only those in targetPlayers list
  const validPlayers = players.filter(function(player) {
    return targetPlayers.indexOf(player.username) !== -1;
  });
  
  // Shuffle both roles and players for random distribution
  const shuffledRoles = shuffleArray([...selectedRoles]);
  const shuffledPlayers = shuffleArray([...validPlayers]);
  
  // Assign roles to players (one role per player, up to the number of roles)
  shuffledPlayers.forEach(function(player, index) {
    if (index < shuffledRoles.length) {
      const playerSocket = io.sockets.connected[player.socketId];
      if (playerSocket) {
        playerSocket.emit('role assigned', {
          role: shuffledRoles[index]
        });
      }
    }
  });
}

// Function to get list of all connected usernames
function getUserList() {
  return players.map(function(p) { return p.username; });
}

io.on('connection', (socket) => {
  var addedUser = false;

  // when the client emits 'new message', this listens and executes
  socket.on('new message', (data) => {
    // we tell the client to execute 'new message'
    socket.broadcast.emit('new message', {
      username: socket.username,
      message: data
    });
  });

  // when the client emits 'add user', this listens and executes
  socket.on('add user', (username) => {
    if (addedUser) return;

    // we store the username in the socket session for this client
    socket.username = username;
    ++numUsers;
    addedUser = true;
    
    // Add player to the players array
    players.push({
      socketId: socket.id,
      username: username
    });
    
    socket.emit('login', {
      numUsers: numUsers
    });
    // echo globally (all clients) that a person has connected
    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers: numUsers
    });
    
    // Send updated user list to all clients
    io.emit('user list', {
      users: getUserList()
    });
    
    // Also send current role selections
    io.emit('role selections updated', {
      selections: roleSelections
    });
  });

  // when the client emits 'typing', we broadcast it to others
  socket.on('typing', () => {
    socket.broadcast.emit('typing', {
      username: socket.username
    });
  });

  // when the client emits 'stop typing', we broadcast it to others
  socket.on('stop typing', () => {
    socket.broadcast.emit('stop typing', {
      username: socket.username
    });
  });

  // when the user disconnects.. perform this
  socket.on('disconnect', () => {
    if (addedUser) {
      --numUsers;
      
      // Remove player from players array
      players = players.filter(p => p.socketId !== socket.id);

      // echo globally that this client has left
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: numUsers
      });
      
      // Remove user's role selection if they had one
      if (roleSelections[socket.username]) {
        delete roleSelections[socket.username];
      }
      
      // Send updated user list to all clients
      io.emit('user list', {
        users: getUserList()
      });
      
      // Also send updated role selections
      io.emit('role selections updated', {
        selections: roleSelections
      });
    }
  });

  // Handle request for user list
  socket.on('get users', () => {
    socket.emit('user list', {
      users: getUserList()
    });
    // Also send current role selections
    socket.emit('role selections updated', {
      selections: roleSelections
    });
  });

  // Handle role selection change
  socket.on('role selection changed', (data) => {
    if (data.username && data.role !== undefined) {
      if (data.role === '') {
        delete roleSelections[data.username];
      } else {
        roleSelections[data.username] = data.role;
      }
      
      // Broadcast updated selections to all clients
      io.emit('role selections updated', {
        selections: roleSelections
      });
    }
  });

  // Handle role assignment request
  socket.on('assign roles', (data) => {
    if (data.selectedRoles && Array.isArray(data.selectedRoles) && 
        data.players && Array.isArray(data.players)) {
      assignRoles(data.selectedRoles, data.players);
    }
  });
});
