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
var roleSets = [{}]; // Array to track role sets: [{username: role}, ...]
var roleAssignments = {}; // Object to track actual role assignments: {username: role}

// Constants
var REVEAL_TEXT_NOTHING = 'You know nothing, good luck!';

// Function to shuffle array (Fisher-Yates shuffle)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Function to check if there's only one Servant in role assignments
function hasSingleServant(roleAssignments) {
  let servantCount = 0;
  Object.keys(roleAssignments).forEach(function(username) {
    if (roleAssignments[username] === 'Servant') {
      servantCount++;
    }
  });
  return servantCount === 1;
}

// Function to replace "Servant" with "Norman" in text if there's only one Servant
function replaceServantWithNorman(text, roleAssignments) {
  if (hasSingleServant(roleAssignments)) {
    return text.replace(/Servant/g, 'Norman');
  }
  return text;
}

// Function to get reveal information for a role
function getRevealInfo(role, roleAssignments, playerUsername) {
  const evilRoles = ['Minion', 'Morgana', 'Assassin', 'Mordred', 'Oberon', 'Brute'];
  const goodRoles = ['Servant', 'Merlin', 'Percival', 'Merlin Pure', 'Tristan', 'Isolde'];
  
  // Build lookup maps
  const roleToPlayers = {};
  const playerToRole = roleAssignments;
  
  Object.keys(playerToRole).forEach(function(username) {
    const roleName = playerToRole[username];
    if (!roleToPlayers[roleName]) {
      roleToPlayers[roleName] = [];
    }
    roleToPlayers[roleName].push(username);
  });
  
  let revealText = '';
  
  switch(role) {
    case 'Servant':
      revealText = REVEAL_TEXT_NOTHING;
      break;
      
    case 'Minion':
    case 'Morgana':
    case 'Assassin':
    case 'Brute':
    case 'Mordred':
    case 'Oberon':
      // Knows other minions of Mordred (evil players except self and Oberon)
      // Note: Oberon sees others but they don't see him
      const minions = [];
      Object.keys(playerToRole).forEach(function(username) {
        if (username === playerUsername) return; // Don't include self
        const playerRole = playerToRole[username];
        if (evilRoles.indexOf(playerRole) !== -1 && playerRole !== 'Oberon') {
          minions.push(username);
        }
      });
      if (minions.length === 0) {
        revealText = REVEAL_TEXT_NOTHING;
      } else {
        revealText = 'Minions of Mordred - ' + minions.join(', ');
      }
      break;
      
    case 'Merlin':
      // Knows minions of Mordred (evil players except Mordred)
      const merlinSees = [];
      Object.keys(playerToRole).forEach(function(username) {
        const playerRole = playerToRole[username];
        if (evilRoles.indexOf(playerRole) !== -1 && playerRole !== 'Mordred') {
          merlinSees.push(username);
        }
      });
      if (merlinSees.length === 0) {
        revealText = REVEAL_TEXT_NOTHING;
      } else {
        revealText = 'Minions of Mordred - ' + merlinSees.join(', ');
      }
      break;
      
    case 'Percival':
      // Knows Merlin and Morgana, but not which is which
      const percivalSees = [];
      if (roleToPlayers['Merlin']) {
        roleToPlayers['Merlin'].forEach(function(name) {
          percivalSees.push(name);
        });
      }
      if (roleToPlayers['Morgana']) {
        roleToPlayers['Morgana'].forEach(function(name) {
          percivalSees.push(name);
        });
      }
      if (percivalSees.length === 0) {
        revealText = REVEAL_TEXT_NOTHING;
      } else {
        // Sort alphabetically to prevent revealing which is which
        percivalSees.sort();
        revealText = 'Merlin or Morgana - ' + percivalSees.join(', ');
      }
      break;
      
    case 'Merlin Pure':
      // Knows exact roles of every player (except own role, which is already shown in role message)
      const allRoles = [];
      Object.keys(playerToRole).forEach(function(username) {
        if (username === playerUsername) return; // Don't include own role
        // Apply transformation to replace "Servant" with "Norman" if there's only one Servant
        const roleName = replaceServantWithNorman(playerToRole[username], roleAssignments);
        allRoles.push(username + ' is ' + roleName);
      });
      if (allRoles.length === 0) {
        revealText = REVEAL_TEXT_NOTHING;
      } else {
        revealText = allRoles.join(', ');
      }
      break;
      
    case 'Tristan':
      // Knows Isolde
      if (roleToPlayers['Isolde'] && roleToPlayers['Isolde'].length > 0) {
        revealText = 'Isolde - ' + roleToPlayers['Isolde'].join(', ');
      } else {
        revealText = REVEAL_TEXT_NOTHING;
      }
      break;
      
    case 'Isolde':
      // Knows Tristan
      if (roleToPlayers['Tristan'] && roleToPlayers['Tristan'].length > 0) {
        revealText = 'Tristan - ' + roleToPlayers['Tristan'].join(', ');
      } else {
        revealText = REVEAL_TEXT_NOTHING;
      }
      break;
      
    default:
      revealText = REVEAL_TEXT_NOTHING;
  }
  
  // Replace "Servant" with "Norman" in reveal text if there's only one Servant
  revealText = replaceServantWithNorman(revealText, roleAssignments);
  
  return revealText;
}

// Function to assign roles randomly from selected roles
function assignRoles(selectedRoles, targetPlayers) {
  // Clear previous assignments
  roleAssignments = {};
  
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
      const assignedRole = shuffledRoles[index];
      roleAssignments[player.username] = assignedRole;
    }
  });
  
  // Now emit role assignments with reveal information
  Object.keys(roleAssignments).forEach(function(username) {
    const assignedRole = roleAssignments[username];
    const player = players.find(function(p) { return p.username === username; });
    if (player) {
      const playerSocket = io.sockets.connected[player.socketId];
      if (playerSocket) {
        const revealInfo = getRevealInfo(assignedRole, roleAssignments, username);
        // Replace "Servant" with "Norman" in role name if there's only one Servant
        const displayRole = replaceServantWithNorman(assignedRole, roleAssignments);
        playerSocket.emit('role assigned', {
          role: displayRole,
          reveal: revealInfo
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
    
    // Also send current role sets
    io.emit('role sets updated', {
      roleSets: roleSets
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
      
      // Remove user from all role sets
      roleSets.forEach(function(roleSet) {
        if (roleSet[socket.username]) {
          delete roleSet[socket.username];
        }
      });
      
      // Remove user's role assignment if they had one
      if (roleAssignments[socket.username]) {
        delete roleAssignments[socket.username];
      }
      
      // Send updated user list to all clients
      io.emit('user list', {
        users: getUserList()
      });
      
      // Also send updated role sets
      io.emit('role sets updated', {
        roleSets: roleSets
      });
    }
  });

  // Handle request for user list
  socket.on('get users', () => {
    socket.emit('user list', {
      users: getUserList()
    });
    // Also send current role sets
    socket.emit('role sets updated', {
      roleSets: roleSets
    });
  });

  // Handle role selection change in a specific role set
  socket.on('role selection changed', (data) => {
    if (data.roleSetIndex !== undefined && data.username && data.role !== undefined) {
      var roleSetIndex = parseInt(data.roleSetIndex);
      // Ensure the role set exists
      while (roleSets.length <= roleSetIndex) {
        roleSets.push({});
      }
      
      if (data.role === '') {
        delete roleSets[roleSetIndex][data.username];
      } else {
        roleSets[roleSetIndex][data.username] = data.role;
      }
      
      // Broadcast updated role sets to all clients
      io.emit('role sets updated', {
        roleSets: roleSets
      });
    }
  });

  // Handle adding a new role set
  socket.on('add role set', () => {
    roleSets.push({});
    // Broadcast updated role sets to all clients
    io.emit('role sets updated', {
      roleSets: roleSets
    });
  });

  // Handle role assignment request
  socket.on('assign roles', (data) => {
    if (data.selectedRoles && Array.isArray(data.selectedRoles) && 
        data.players && Array.isArray(data.players)) {
      assignRoles(data.selectedRoles, data.players);
    }
  });
});
