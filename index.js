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

// Voting state
var currentVote = null; // {team: [...], leader: '...', votes: {username: 'y'|'n'}, questIndex: number}
var currentQuestVote = null; // {questIndex: number, team: [...], votes: {username: 'y'|'n'}}
var currentQuestIndex = 1; // Track current quest index
var currentVoteTrack = 1; // Track current vote track (1-5)
var questResults = {}; // Track quest results: {questIndex: 'success'|'fail'}
var assassinPhase = false; // Track if assassin phase is active
var globalAssassinInfo = null; // Store assassin info: {player: {...}, targets: [...], description: '...', needsBoth: boolean, guessedTargets: []}

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
      
    case 'Oberon':
      // Oberon doesn't know other minions and they don't know him (reflexive)
      revealText = REVEAL_TEXT_NOTHING;
      break;
      
    case 'Minion':
    case 'Morgana':
    case 'Assassin':
    case 'Brute':
    case 'Mordred':
      // Knows other minions of Mordred (evil players except self and Oberon)
      // Note: Oberon is excluded from their view
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
      // If Merlin Pure, Percival, and Morgana are all present, Percival sees Merlin Pure and Morgana
      const percivalSees = [];
      const hasMerlinPure = roleToPlayers['Merlin Pure'] && roleToPlayers['Merlin Pure'].length > 0;
      const hasMorgana = roleToPlayers['Morgana'] && roleToPlayers['Morgana'].length > 0;
      
      // If Merlin Pure and Morgana are both present (and Percival exists, which we know since we're in this case),
      // Percival sees Merlin Pure and Morgana
      if (hasMerlinPure && hasMorgana) {
        if (roleToPlayers['Merlin Pure']) {
          roleToPlayers['Merlin Pure'].forEach(function(name) {
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
          revealText = 'Merlin Pure or Morgana - ' + percivalSees.join(', ');
        }
      } else {
        // Default behavior: sees Merlin and Morgana
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

// Function to get quest size based on quest index and number of players
function getQuestSize(questIndex, numPlayers) {
  var questSize = {
    '1,5': 2, '1,6': 2, '1,7': 2, '1,8': 3, '1,9': 3, '1,10': 3,
    '2,5': 3, '2,6': 3, '2,7': 3, '2,8': 4, '2,9': 4, '2,10': 4,
    '3,5': 2, '3,6': 4, '3,7': 3, '3,8': 4, '3,9': 4, '3,10': 4,
    '4,5': 3, '4,6': 3, '4,7': 4, '4,8': 5, '4,9': 5, '4,10': 5,
    '5,5': 3, '5,6': 4, '5,7': 4, '5,8': 5, '5,9': 5, '5,10': 5,
  };
  var key = questIndex + ',' + numPlayers;
  return questSize[key] || 0;
}

// Function to emit waiting status updates
function emitWaitingStatus() {
  // Clear any existing waiting status first
  io.emit('waiting status', {
    waitingOn: null
  });
  
  // Check for team selection (leader needs to propose team)
  if (players.length > 0 && !currentVote && !currentQuestVote && !assassinPhase) {
    var leader = players[0];
    // Only emit if we're in a game (roles assigned)
    if (Object.keys(roleAssignments).length > 0) {
      io.emit('waiting status', {
        waitingOn: [leader.username],
        context: 'team selection'
      });
      return;
    }
  }
  
  // Check for votes
  if (currentVote) {
    var waitingOnVotes = [];
    players.forEach(function(player) {
      if (!currentVote.votes[player.username]) {
        waitingOnVotes.push(player.username);
      }
    });
    if (waitingOnVotes.length > 0) {
      io.emit('waiting status', {
        waitingOn: waitingOnVotes,
        context: 'vote'
      });
      return;
    }
  }
  
  // Check for quest votes
  if (currentQuestVote) {
    var waitingOnQuestVotes = [];
    currentQuestVote.team.forEach(function(teamMember) {
      if (!currentQuestVote.votes[teamMember]) {
        waitingOnQuestVotes.push(teamMember);
      }
    });
    if (waitingOnQuestVotes.length > 0) {
      io.emit('waiting status', {
        waitingOn: waitingOnQuestVotes,
        context: 'quest vote'
      });
      return;
    }
  }
  
  // Check for assassin guess
  if (assassinPhase && globalAssassinInfo) {
    io.emit('waiting status', {
      waitingOn: [globalAssassinInfo.player.username],
      context: 'assassin guess'
    });
    return;
  }
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

    // Check if username is already taken
    var usernameTaken = players.some(function(player) {
      return player.username === username;
    });

    if (usernameTaken) {
      // Username is already taken, emit error
      socket.emit('username taken', {
        message: 'Username "' + username + '" is already taken. Please choose another.'
      });
      return;
    }

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
      users: getUserList(),
      voteTrack: currentVoteTrack,
      questIndex: currentQuestIndex
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
        users: getUserList(),
        voteTrack: currentVoteTrack,
        questIndex: currentQuestIndex
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
      users: getUserList(),
      voteTrack: currentVoteTrack,
      questIndex: currentQuestIndex
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

  // Handle deleting a role set
  socket.on('delete role set', (data) => {
    if (data.roleSetIndex !== undefined && roleSets.length > 1) {
      var roleSetIndex = parseInt(data.roleSetIndex);
      // Ensure the index is valid
      if (roleSetIndex >= 0 && roleSetIndex < roleSets.length) {
        // Remove the role set at the specified index
        roleSets.splice(roleSetIndex, 1);
        // Ensure we always have at least one role set
        if (roleSets.length === 0) {
          roleSets.push({});
        }
        // Broadcast updated role sets to all clients
        io.emit('role sets updated', {
          roleSets: roleSets
        });
      }
    }
  });

  // Handle role assignment request
  socket.on('assign roles', (data) => {
    if (data.selectedRoles && Array.isArray(data.selectedRoles) && 
        data.players && Array.isArray(data.players)) {
      
      
      // Reset game state for new game
      currentQuestIndex = 1;
      currentVoteTrack = 1;
      questResults = {};
      assassinPhase = false;
      globalAssassinInfo = null;
      
      // Clear any existing waiting status
      io.emit('waiting status', {
        waitingOn: null
      });
      
      assignRoles(data.selectedRoles, data.players);
      
      // Send updated state to all clients
      io.emit('user list', {
        users: getUserList(),
        voteTrack: currentVoteTrack,
        questIndex: currentQuestIndex
      });
      
      // Emit waiting status for team selection (after a small delay to ensure roles are assigned)
      setTimeout(function() {
        emitWaitingStatus();
      }, 100);
    }
  });

  // Handle team selection confirmation
  socket.on('confirm team', (data) => {
    if (data.team && Array.isArray(data.team)) {
      // Validate team size
      var numPlayers = players.length;
      if (numPlayers < 5) numPlayers = 5;
      if (numPlayers > 10) numPlayers = 10;
      
      var requiredTeamSize = getQuestSize(currentQuestIndex, numPlayers);
      
      if (data.team.length !== requiredTeamSize) {
        // Team size is incorrect, notify the leader
        socket.emit('team size error', {
          message: 'Team size must be exactly ' + requiredTeamSize + ' players for Quest ' + currentQuestIndex + '. You selected ' + data.team.length + ' players.',
          requiredSize: requiredTeamSize,
          actualSize: data.team.length,
          questIndex: currentQuestIndex
        });
        return;
      }
      
      // Initialize voting
      currentVote = {
        team: data.team,
        leader: socket.username,
        votes: {},
        questIndex: currentQuestIndex
      };
      
      // Broadcast the selected team to all players and request votes
      io.emit('team selected', {
        leader: socket.username,
        team: data.team
      });
      
      // Request votes from all players
      io.emit('request vote', {
        team: data.team,
        leader: socket.username,
        voteTrack: currentVoteTrack,
        questIndex: currentQuestIndex
      });
      
      // Emit waiting status
      emitWaitingStatus();
    }
  });

  // Handle vote submission
  socket.on('submit vote', (data) => {
    if (currentVote && data.vote && (data.vote === 'y' || data.vote === 'n')) {
      // Record the vote
      currentVote.votes[socket.username] = data.vote;
      
      // Emit updated waiting status
      emitWaitingStatus();
      
      // Check if all players have voted
      var allVoted = true;
      players.forEach(function(player) {
        if (!currentVote.votes[player.username]) {
          allVoted = false;
        }
      });
      
      if (allVoted) {
        // Count votes and collect voter identities
        var approveCount = 0;
        var rejectCount = 0;
        var approveVoters = [];
        var rejectVoters = [];
        
        Object.keys(currentVote.votes).forEach(function(username) {
          if (currentVote.votes[username] === 'y') {
            approveCount++;
            approveVoters.push(username);
          } else {
            rejectCount++;
            rejectVoters.push(username);
          }
        });
        
        var totalVotes = approveCount + rejectCount;
        var majority = Math.floor(totalVotes / 2) + 1;
        var approved = approveCount >= majority;
        
        // Increment vote track if rejected
        if (!approved) {
          currentVoteTrack++;
          if (currentVoteTrack > 5) {
            currentVoteTrack = 5; // Cap at 5
          }
        }
        
        // Broadcast result with individual votes
        io.emit('vote result', {
          approved: approved,
          approveCount: approveCount,
          rejectCount: rejectCount,
          approveVoters: approveVoters,
          rejectVoters: rejectVoters,
          team: currentVote.team,
          leader: currentVote.leader,
          voteTrack: currentVoteTrack
        });
        
        // Check if vote track reached 5 - evil team wins
        if (currentVoteTrack >= 5 && !approved) {
          io.emit('game over', {
            winner: 'evil',
            reason: 'Vote track reached 5. Spies win!'
          });
        }
        
        // If approved, start quest voting instead of immediately proceeding
        if (approved && currentVote.questIndex) {
          // Initialize quest voting
          currentQuestVote = {
            questIndex: currentVote.questIndex,
            team: currentVote.team,
            votes: {}
          };
          
          // Request quest votes from team members only
          currentVote.team.forEach(function(teamMember) {
            var teamPlayer = players.find(function(p) { return p.username === teamMember; });
            if (teamPlayer) {
              var teamPlayerSocket = io.sockets.connected[teamPlayer.socketId];
              if (teamPlayerSocket) {
                teamPlayerSocket.emit('request quest vote', {
                  questIndex: currentVote.questIndex,
                  team: currentVote.team
                });
              }
            }
          });
          
          // Emit waiting status for quest votes
          emitWaitingStatus();
        }
        
        // Rotate leader (both for approved and rejected)
        if (players.length > 1) {
          var firstPlayer = players.shift();
          players.push(firstPlayer);
          
          // Send updated user list to all clients
          io.emit('user list', {
            users: getUserList(),
            voteTrack: currentVoteTrack,
            questIndex: currentQuestIndex
          });
        }
        
        // Clear current vote
        currentVote = null;
        
        // Clear waiting status
        emitWaitingStatus();
      }
    }
  });

  // Handle quest vote submission
  socket.on('submit quest vote', (data) => {
    if (currentQuestVote && data.vote && (data.vote === 'y' || data.vote === 'n')) {
      // Only accept votes from team members
      if (currentQuestVote.team.indexOf(socket.username) === -1) {
        return;
      }
      
      // Record the vote
      currentQuestVote.votes[socket.username] = data.vote;
      
      // Emit updated waiting status
      emitWaitingStatus();
      
      // Check if all team members have voted
      var allVoted = true;
      currentQuestVote.team.forEach(function(teamMember) {
        if (!currentQuestVote.votes[teamMember]) {
          allVoted = false;
        }
      });
      
      if (allVoted) {
        // Count votes
        var successCount = 0;
        var failCount = 0;
        
        Object.keys(currentQuestVote.votes).forEach(function(username) {
          if (currentQuestVote.votes[username] === 'y') {
            successCount++;
          } else {
            failCount++;
          }
        });
        
        // Determine quest success/failure: if there's a single FAIL vote, quest fails
        var questSucceeded = failCount === 0;
        
        // Store quest result
        questResults[currentQuestVote.questIndex] = questSucceeded ? 'success' : 'fail';
        
        // Count successful quests
        var successfulQuests = 0;
        Object.keys(questResults).forEach(function(questIndex) {
          if (questResults[questIndex] === 'success') {
            successfulQuests++;
          }
        });
        
        // Reset vote track to 1 when quest completes
        currentVoteTrack = 1;
        
        // Broadcast quest result to all players
        io.emit('quest result', {
          questIndex: currentQuestVote.questIndex,
          team: currentQuestVote.team,
          successCount: successCount,
          failCount: failCount,
          questSucceeded: questSucceeded,
          successfulQuests: successfulQuests,
          voteTrack: currentVoteTrack
        });
        
        // Check if good team has won 3 quests - trigger assassin phase
        if (successfulQuests >= 3) {
          // Check if there's a Merlin, Merlin Pure, or Tristan/Isolde pair
          var hasMerlin = false;
          var hasMerlinPure = false;
          var hasTristan = false;
          var hasIsolde = false;
          
          Object.keys(roleAssignments).forEach(function(username) {
            var role = roleAssignments[username];
            if (role === 'Merlin') hasMerlin = true;
            if (role === 'Merlin Pure') hasMerlinPure = true;
            if (role === 'Tristan') hasTristan = true;
            if (role === 'Isolde') hasIsolde = true;
          });
          
          var shouldTriggerAssassin = hasMerlin || hasMerlinPure || (hasTristan && hasIsolde);
          
          if (shouldTriggerAssassin) {
            assassinPhase = true;
            
            // Randomly select an evil team member to be the assassin
            const evilRoles = ['Minion', 'Morgana', 'Mordred', 'Oberon', 'Brute'];
            var evilPlayers = [];
            players.forEach(function(player) {
              var role = roleAssignments[player.username];
              if (evilRoles.indexOf(role) !== -1) {
                evilPlayers.push(player);
              }
            });
            
            if (evilPlayers.length > 0) {
              // Randomly select one evil player
              var assassinPlayer = evilPlayers[Math.floor(Math.random() * evilPlayers.length)];
              
              // Determine who the assassin needs to kill
              var assassinTargets = [];
              var targetDescription = '';
              
              if (hasMerlin) {
                Object.keys(roleAssignments).forEach(function(username) {
                  if (roleAssignments[username] === 'Merlin') {
                    assassinTargets.push(username);
                  }
                });
                targetDescription = 'Merlin';
              } else if (hasMerlinPure) {
                Object.keys(roleAssignments).forEach(function(username) {
                  if (roleAssignments[username] === 'Merlin Pure') {
                    assassinTargets.push(username);
                  }
                });
                targetDescription = 'Merlin Pure';
              } else if (hasTristan && hasIsolde) {
                // Need to kill BOTH Tristan and Isolde
                Object.keys(roleAssignments).forEach(function(username) {
                  if (roleAssignments[username] === 'Tristan' || roleAssignments[username] === 'Isolde') {
                    assassinTargets.push(username);
                  }
                });
                targetDescription = 'both Tristan and Isolde';
              }
              
              // Store assassin info (we'll need to track this for win condition checking)
              // We'll store it in a variable accessible to the guess handler
              var currentAssassinInfo = {
                player: assassinPlayer,
                targets: assassinTargets,
                description: targetDescription,
                needsBoth: !hasMerlin && !hasMerlinPure && hasTristan && hasIsolde,
                guessedTargets: [] // Track which targets have been correctly guessed
              };
              
              // Notify all players that assassin phase has begun
              io.emit('assassin phase started', {
                assassin: assassinPlayer.username
              });
              
              // Then request assassin to make their guess (with delay to ensure message order)
              var assassinSocket = io.sockets.connected[assassinPlayer.socketId];
              if (assassinSocket) {
                // Get minions of Mordred (evil players except self and Oberon)
                const minions = [];
                Object.keys(roleAssignments).forEach(function(username) {
                  if (username === assassinPlayer.username) return; // Don't include self
                  const playerRole = roleAssignments[username];
                  if (evilRoles.indexOf(playerRole) !== -1 && playerRole !== 'Oberon') {
                    minions.push(username);
                  }
                });
                
                // Get good team players (only these can be guessed)
                const goodRoles = ['Servant', 'Merlin', 'Percival', 'Merlin Pure', 'Tristan', 'Isolde'];
                const goodTeamPlayers = [];
                Object.keys(roleAssignments).forEach(function(username) {
                  const playerRole = roleAssignments[username];
                  if (goodRoles.indexOf(playerRole) !== -1) {
                    goodTeamPlayers.push(username);
                  }
                });
                
                setTimeout(function() {
                  assassinSocket.emit('request assassin guess', {
                    players: getUserList(),
                    goodTeamPlayers: goodTeamPlayers,
                    minionsOfMordred: minions.length > 0 ? minions : null,
                    targets: assassinTargets,
                    targetDescription: targetDescription,
                    needsBoth: currentAssassinInfo.needsBoth
                  });
                  
                  // Store assassin info globally for win condition checking
                  globalAssassinInfo = currentAssassinInfo;
                  
                  // Emit waiting status for assassin guess
                  emitWaitingStatus();
                }, 500); // Small delay to ensure general message arrives first
              }
            } else {
              // No evil players in game (shouldn't happen, but handle it)
              io.emit('game over', {
                winner: 'good',
                reason: 'Good team won 3 quests'
              });
            }
          } else {
            // No Merlin/Merlin Pure/Tristan-Isolde, good team wins immediately
            io.emit('game over', {
              winner: 'good',
              reason: 'Good team won 3 quests'
            });
          }
        } else {
          // Increment quest index for next quest
          currentQuestIndex++;
        }
        
        // Clear quest vote
        currentQuestVote = null;
        
        // Clear waiting status
        emitWaitingStatus();
      }
    }
  });

  // Handle request to start team selection for a quest
  socket.on('start team selection', (data) => {
    // Don't allow team selection during assassin phase
    if (assassinPhase) {
      return;
    }
    
    if (data.questIndex && players.length > 0) {
      // Update current quest index if provided
      if (data.questIndex) {
        currentQuestIndex = data.questIndex;
      }
      
      // Calculate required team size (server is single source of truth)
      var numPlayers = players.length;
      if (numPlayers < 5) numPlayers = 5;
      if (numPlayers > 10) numPlayers = 10;
      var requiredTeamSize = getQuestSize(currentQuestIndex, numPlayers);
      
      var leader = players[0];
      var leaderSocket = io.sockets.connected[leader.socketId];
      if (leaderSocket) {
        leaderSocket.emit('request team selection', {
          questIndex: currentQuestIndex,
          requiredTeamSize: requiredTeamSize
        });
      }
      
      // Emit waiting status for team selection
      emitWaitingStatus();
    }
  });

  // Handle assassin guess submission
  socket.on('submit assassin guess', (data) => {
    if (!assassinPhase || !globalAssassinInfo) {
      return;
    }
    
    // Verify the sender is the selected assassin
    if (socket.username !== globalAssassinInfo.player.username) {
      return;
    }
    
    if (data.guess && typeof data.guess === 'string') {
      var guessedPlayer = data.guess;
      
      // Validate that the guessed player is on the good team
      const goodRoles = ['Servant', 'Merlin', 'Percival', 'Merlin Pure', 'Tristan', 'Isolde'];
      if (!roleAssignments[guessedPlayer] || goodRoles.indexOf(roleAssignments[guessedPlayer]) === -1) {
        // Invalid guess - must be a good team member
        socket.emit('assassin guess error', {
          message: 'You can only guess players on the good team. Please select a good team member.'
        });
        return;
      }
      
      // Check if the guess is correct based on win conditions
      var guessedRole = roleAssignments[guessedPlayer];
      var isCorrectTarget = globalAssassinInfo.targets.indexOf(guessedPlayer) !== -1;
      
      if (globalAssassinInfo.needsBoth) {
        // Need to kill BOTH Tristan and Isolde
        if (isCorrectTarget) {
          // Add to guessed targets if not already there
          if (globalAssassinInfo.guessedTargets.indexOf(guessedPlayer) === -1) {
            globalAssassinInfo.guessedTargets.push(guessedPlayer);
          }
          
          // Check if both targets have been guessed
          var allTargetsGuessed = globalAssassinInfo.targets.every(function(target) {
            return globalAssassinInfo.guessedTargets.indexOf(target) !== -1;
          });
          
          if (allTargetsGuessed) {
            // Both targets guessed correctly - evil wins
            assassinPhase = false;
            var assassinInfo = globalAssassinInfo;
            globalAssassinInfo = null;
            
            // Clear waiting status
            io.emit('waiting status', {
              waitingOn: null
            });
            
            var reason = 'Assassin correctly identified both ' + assassinInfo.description + ': ' + assassinInfo.guessedTargets.join(' and ');
            io.emit('game over', {
              winner: 'evil',
              reason: reason,
              guessedPlayers: assassinInfo.guessedTargets,
              targetDescription: assassinInfo.description
            });
          } else {
            // One target guessed correctly, but need the other one too
            var remainingTargets = globalAssassinInfo.targets.filter(function(target) {
              return globalAssassinInfo.guessedTargets.indexOf(target) === -1;
            });
            socket.emit('assassin guess partial', {
              message: 'Correct! You identified ' + guessedPlayer + '. You still need to identify: ' + remainingTargets.join(' and '),
              guessedTargets: globalAssassinInfo.guessedTargets,
              remainingTargets: remainingTargets
            });
            // Emit waiting status to allow another guess
            emitWaitingStatus();
            return; // Don't end the game yet
          }
        } else {
          // Wrong guess - good wins
          assassinPhase = false;
          var assassinInfo = globalAssassinInfo;
          globalAssassinInfo = null;
          
          // Clear waiting status
          io.emit('waiting status', {
            waitingOn: null
          });
          
          var actualTargets = assassinInfo.targets.map(function(target) {
            return target + ' (' + roleAssignments[target] + ')';
          }).join(' and ');
          io.emit('game over', {
            winner: 'good',
            reason: 'Assassin incorrectly guessed ' + guessedPlayer + '. The targets were: ' + actualTargets,
            guessedPlayer: guessedPlayer,
            actualTargets: assassinInfo.targets
          });
        }
      } else {
        // Need to kill Merlin or Merlin Pure - single target
        if (isCorrectTarget) {
          // Correct guess - evil wins
          assassinPhase = false;
          var assassinInfo = globalAssassinInfo;
          globalAssassinInfo = null;
          
          // Clear waiting status
          io.emit('waiting status', {
            waitingOn: null
          });
          
          var reason = 'Assassin correctly identified ' + assassinInfo.description + ': ' + guessedPlayer;
          io.emit('game over', {
            winner: 'evil',
            reason: reason,
            guessedPlayer: guessedPlayer,
            targetDescription: assassinInfo.description
          });
        } else {
          // Wrong guess - good wins
          assassinPhase = false;
          var assassinInfo = globalAssassinInfo;
          globalAssassinInfo = null;
          
          // Clear waiting status
          io.emit('waiting status', {
            waitingOn: null
          });
          
          var actualTargets = assassinInfo.targets.map(function(target) {
            return target + ' (' + roleAssignments[target] + ')';
          }).join(', ');
          io.emit('game over', {
            winner: 'good',
            reason: 'Assassin incorrectly guessed ' + guessedPlayer + '. The target was: ' + actualTargets,
            guessedPlayer: guessedPlayer,
            actualTargets: assassinInfo.targets
          });
        }
      }
    }
  });
});
