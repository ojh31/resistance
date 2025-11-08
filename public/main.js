$(function() {
  var FADE_TIME = 150; // ms
  var TYPING_TIMER_LENGTH = 400; // ms
  var COLORS = [
    '#e21400', '#91580f', '#f8a700', '#f78b00',
    '#58dc00', '#287b00', '#a8f07a', '#4ae8c4',
    '#3b88eb', '#3824aa', '#a700ff', '#d300e7'
  ];

  // Initialize variables
  var $window = $(window);
  var $usernameInput = $('.usernameInput'); // Input for username
  var $messages = $('.messages'); // Messages area
  var $inputMessage = $('.inputMessage'); // Input message input box

  var $loginPage = $('.login.page'); // The login page
  var $chatPage = $('.chat.page'); // The chatroom page

  // Prompt for setting a username
  var username;
  var connected = false;
  var typing = false;
  var lastTypingTime;
  var $currentInput = $usernameInput.focus();

  var socket = io();
  
  // Role assignment variables
  var connectedUsers = []; // Array to track all connected users
  var availableRoles = [
    'Servant', 'Minion','Merlin', 'Percival', 'Morgana', 'Assassin',
    'Mordred', 'Oberon', 'Merlin Pure', 'Tristan', 'Isolde',
    'Brute',
  ];
  var $playerRoles = $('#playerRoles');
  var $assignButton = $('#assignButton');
  var $playerCircleContainer = $('#playerCircleContainer');
  var $questTokensContainer = $('#questTokensContainer');

  // Role sets state - array of role set objects, each is {username: role}
  var roleSets = [{}]; // Start with one empty role set
  
  // Team selection state
  var isSelectingTeam = false;
  var selectedTeam = [];
  var requiredTeamSize = 0;
  var currentQuestIndex = 1;
  
  // Voting state
  var isVoting = false;
  var pendingVote = null; // Stores the vote ('y' or 'n') waiting for confirmation
  var currentVoteTrack = 1;

  // Update the player circle visualization
  const updatePlayerCircle = () => {
    $playerCircleContainer.empty();
    
    if (connectedUsers.length === 0) {
      return;
    }
    
    var $circle = $('<div class="playerCircle"></div>');
    var centerX = 100; // Center of the 200px container
    var centerY = 100;
    var radius = 70; // Radius of the circle
    
    // Position players in a circle, starting from top (12 o'clock) and going clockwise
    connectedUsers.forEach(function(user, index) {
      // Calculate angle: start at -90 degrees (top) and go clockwise
      // -90 degrees = top, 0 degrees = right, 90 degrees = bottom, 180 degrees = left
      var angle = (-90 + (360 / connectedUsers.length) * index) * (Math.PI / 180);
      
      // Calculate position
      var x = centerX + radius * Math.cos(angle) - 30; // -30 to center the 60px item
      var y = centerY + radius * Math.sin(angle) - 30;
      
      // Create player item
      var $playerItem = $('<div class="playerCircleItem"></div>')
        .text(user)
        .css({
          left: x + 'px',
          top: y + 'px',
          backgroundColor: getUsernameColor(user),
          color: '#fff'
        })
        .data('username', user);
      
      // Make clickable if user is leader and team selection is active
      if (isSelectingTeam && username === connectedUsers[0]) {
        $playerItem.addClass('clickable');
        $playerItem.css('cursor', 'pointer');
        
        // Check if this player is selected
        if (selectedTeam.indexOf(user) !== -1) {
          $playerItem.addClass('selected');
          $playerItem.css('border', '3px solid #FFD700');
        }
        
        // Add click handler to toggle selection
        $playerItem.on('click', function() {
          var clickedUser = $(this).data('username');
          var index = selectedTeam.indexOf(clickedUser);
          
          if (index === -1) {
            // Add to selection if not already selected and under size limit
            if (selectedTeam.length < requiredTeamSize) {
              selectedTeam.push(clickedUser);
              $(this).addClass('selected');
              $(this).css('border', '3px solid #FFD700');
            }
          } else {
            // Remove from selection
            selectedTeam.splice(index, 1);
            $(this).removeClass('selected');
            $(this).css('border', '2px solid #333');
          }
          
          // Update preview
          updateTeamPreview();
        });
      }
      
      $circle.append($playerItem);
      
      // Add crown symbol over the first player (leader)
      if (index === 0) {
        var $crown = $('<div class="leaderCrown">♔</div>')
          .css({
            left: (x + 30) + 'px', // Center of the player item (x + 30 = center of 60px item)
            top: (y - 15) + 'px'   // Above the player item
          });
        $circle.append($crown);
      }
      
      // Add hammer symbol over the player who will be leader on vote 5
      // Leader rotates after each vote, so vote 5 leader is at index (5 - currentVoteTrack) % numPlayers
      if (currentVoteTrack < 5) {
        var votesUntilVote5 = 5 - currentVoteTrack;
        var vote5LeaderIndex = votesUntilVote5 % connectedUsers.length;
        if (index === vote5LeaderIndex) {
          var $hammer = $('<div class="leaderHammer">⚒</div>')
            .css({
              left: (x + 30) + 'px', // Center of the player item
              top: (y + 40) + 'px'   // Half on the bottom of the player item (player item is 60px tall)
            });
          $circle.append($hammer);
        }
      }
    });
    
    $playerCircleContainer.append($circle);
  };

  // Get quest size based on quest index and number of players
  const getQuestSize = (questIndex, numPlayers) => {
    var questSize = {
      '1,5': 2, '1,6': 2, '1,7': 2, '1,8': 3, '1,9': 3, '1,10': 3,
      '2,5': 3, '2,6': 3, '2,7': 3, '2,8': 4, '2,9': 4, '2,10': 4,
      '3,5': 2, '3,6': 4, '3,7': 3, '3,8': 4, '3,9': 4, '3,10': 4,
      '4,5': 3, '4,6': 3, '4,7': 4, '4,8': 5, '4,9': 5, '4,10': 5,
      '5,5': 3, '5,6': 4, '5,7': 4, '5,8': 5, '5,9': 5, '5,10': 5,
    };
    var key = questIndex + ',' + numPlayers;
    return questSize[key] || 0;
  };

  // Initialize quest tokens
  const initializeQuestTokens = () => {
    $questTokensContainer.empty();
    
    var numPlayers = connectedUsers.length;
    if (numPlayers < 5) {
      numPlayers = 5; // Default to minimum
    } else if (numPlayers > 10) {
      numPlayers = 10; // Cap at maximum
    }
    
    var $questTokens = $('<div class="questTokens"></div>');
    
    // Create 5 quest tokens
    for (var i = 1; i <= 5; i++) {
      var questSize = getQuestSize(i, numPlayers);
      
      var $questToken = $('<div class="questToken"></div>');
      
      // Add quest label at the top
      var $questLabel = $('<div class="questTokenLabel">quest ' + i + '</div>');
      $questToken.append($questLabel);
      
      // Add quest size number in the middle
      var $questSize = $('<div class="questTokenSize">' + questSize + '</div>');
      $questToken.append($questSize);
      
      // Add active marker based on currentQuestIndex
      if (i === currentQuestIndex) {
        $questToken.addClass('active');
        var $marker = $('<div class="questTokenMarker"></div>');
        $questToken.append($marker);
      }
      
      $questTokens.append($questToken);
    }
    
    $questTokensContainer.append($questTokens);
    
    // Initialize vote track underneath quest tokens
    initializeVoteTrack();
  };

  // Initialize vote track
  const initializeVoteTrack = () => {
    // Remove existing vote track if any
    $questTokensContainer.find('.voteTrack').remove();
    
    var $voteTrack = $('<div class="voteTrack"></div>');
    var $voteTrackLabel = $('<div class="voteTrackLabel">Vote Track</div>');
    $voteTrack.append($voteTrackLabel);
    
    var $voteTrackTiles = $('<div class="voteTrackTiles"></div>');
    
    // Create 5 vote track tiles
    for (var i = 1; i <= 5; i++) {
      var $voteTile = $('<div class="voteTrackTile"></div>')
        .text(i);
      
      // Add active highlight based on currentVoteTrack
      if (i === currentVoteTrack) {
        $voteTile.addClass('active');
        var $marker = $('<div class="questTokenMarker"></div>');
        $voteTile.append($marker);
      }
      
      $voteTrackTiles.append($voteTile);
    }
    
    $voteTrack.append($voteTrackTiles);
    $questTokensContainer.append($voteTrack);
  };

  // Update quest token to next quest
  const incrementQuestToken = () => {
    // Remove active marker from current quest
    var $currentQuest = $('.questToken.active');
    $currentQuest.removeClass('active');
    $currentQuest.find('.questTokenMarker').remove();
    
    // Move to next quest
    currentQuestIndex++;
    if (currentQuestIndex <= 5) {
      var $nextQuest = $('.questToken').eq(currentQuestIndex - 1);
      $nextQuest.addClass('active');
      var $marker = $('<div class="questTokenMarker"></div>');
      $nextQuest.append($marker);
    }
  };

  // Update vote track to next vote
  const incrementVoteTrack = () => {
    currentVoteTrack++;
    if (currentVoteTrack <= 5) {
      initializeVoteTrack();
    }
  };

  // Rotate leader to next player (server handles this, just update display)
  const rotateLeader = () => {
    // Server will send updated user list, so we just wait for it
    // The updatePlayerCircle will be called when user list is received
  };

  // Request team selection from leader
  const requestTeamSelection = (questIndex) => {
    if (connectedUsers.length === 0) return;
    
    var leader = connectedUsers[0];
    var numPlayers = connectedUsers.length;
    if (numPlayers < 5) numPlayers = 5;
    if (numPlayers > 10) numPlayers = 10;
    
    var questSize = getQuestSize(questIndex, numPlayers);
    
    // Only activate for the leader
    if (username === leader) {
      // Prevent duplicate requests for the same quest
      if (isSelectingTeam && currentQuestIndex === questIndex) {
        return;
      }
      
      currentQuestIndex = questIndex;
      requiredTeamSize = questSize;
      isSelectingTeam = true;
      selectedTeam = [];
      
      // Send private message to leader
      log('You are the leader. Select a team of ' + questSize + ' players for Quest ' + questIndex + '. Click on player tiles to select them ("y" to confirm)', {
        prepend: false
      });
      
      // Update player circle to make tiles clickable
      updatePlayerCircle();
      
      // Show initial preview
      updateTeamPreview();
    }
  };

  // Update team selection preview
  const updateTeamPreview = () => {
    // Remove existing preview
    $('.teamPreview').remove();
    
    if (!isSelectingTeam || username !== connectedUsers[0]) {
      return;
    }
    
    var previewText = 'Selected team (' + selectedTeam.length + '/' + requiredTeamSize + '): ';
    if (selectedTeam.length === 0) {
      previewText += 'None';
    } else {
      previewText += selectedTeam.join(', ');
    }
    
    var $preview = $('<li class="log teamPreview">' + previewText + '</li>');
    addMessageElement($preview, {
      prepend: false
    });
  };

  // Update the role assignment UI
  const updateRoleAssignmentUI = () => {
    $playerRoles.empty();
    
    // Create a row for each role set
    roleSets.forEach(function(roleSet, roleSetIndex) {
      var $roleSetRow = $('<div class="roleSetRow"></div>');
      
      // Create a dropdown for each connected player in this role set
      connectedUsers.forEach(function(user) {
        var $playerItem = $('<div class="playerRoleItem"></div>');
        var $roleSelect = $('<select></select>')
          .attr('data-username', user)
          .attr('data-role-set-index', roleSetIndex);
        
        // Add empty option
        $('<option></option>').attr('value', '').text('No role').appendTo($roleSelect);
        
        // Add all available roles
        availableRoles.forEach(function(role) {
          var $option = $('<option></option>').attr('value', role).text(role);
          // Mark as selected if this role is already selected for this user in this role set
          if (roleSet[user] === role) {
            $option.attr('selected', 'selected');
          }
          $option.appendTo($roleSelect);
        });
        
        // Handle dropdown change - sync with server
        $roleSelect.on('change', function() {
          var selectedRole = $(this).val();
          var username = $(this).attr('data-username');
          var index = parseInt($(this).attr('data-role-set-index'));
          // Emit change to server
          socket.emit('role selection changed', {
            roleSetIndex: index,
            username: username,
            role: selectedRole || ''
          });
        });
        
        $playerItem.append($roleSelect);
        $roleSetRow.append($playerItem);
      });
      
      $playerRoles.append($roleSetRow);
    });
    
    // Add "Add Role Set" button after the last role set row
    var $addRoleSetButton = $('<button class="addRoleSetButton" id="addRoleSetButton">Add Role Set</button>');
    $addRoleSetButton.on('click', function() {
      socket.emit('add role set'); // Request server to add a new role set
    });
    $playerRoles.append($addRoleSetButton);
  }

  // Handle assign button click
  $assignButton.on('click', () => {
    // Filter out empty role sets
    var validRoleSets = roleSets.filter(function(roleSet) {
      return Object.keys(roleSet).some(function(user) {
        return roleSet[user] && roleSet[user] !== '';
      });
    });
    
    if (validRoleSets.length === 0) {
      log('Please select at least one role in at least one role set', {
        prepend: false
      });
      return;
    }
    
    // Randomly select one role set uniformly
    var selectedRoleSetIndex = Math.floor(Math.random() * validRoleSets.length);
    var selectedRoleSet = validRoleSets[selectedRoleSetIndex];
    
    // Collect all selected roles from the randomly selected role set (duplicates allowed)
    var selectedRoles = [];
    
    connectedUsers.forEach(function(user) {
      if (selectedRoleSet[user] && selectedRoleSet[user] !== '') {
        selectedRoles.push(selectedRoleSet[user]);
      }
    });
    
    if (selectedRoles.length === 0) {
      log('Please select at least one role', {
        prepend: false
      });
      return;
    }
    
    // Send selected roles to server for random distribution
    socket.emit('assign roles', {
      selectedRoles: selectedRoles,
      players: connectedUsers
    });
    
    // After roles are assigned, automatically request team selection for quest 1
    setTimeout(function() {
      socket.emit('start team selection', {
        questIndex: 1
      });
    }, 1000); // Small delay to ensure roles are assigned first
  });

  const addParticipantsMessage = (data) => {
    var message = '';
    if (data.numUsers === 1) {
      message += "there's 1 participant";
    } else {
      message += "there are " + data.numUsers + " participants";
    }
    log(message);
  }

  // Sets the client's username
  const setUsername = () => {
    username = cleanInput($usernameInput.val().trim());

    // If the username is valid
    if (username) {
      $loginPage.fadeOut();
      $chatPage.show();
      $loginPage.off('click');
      $currentInput = $inputMessage.focus();

      // Tell the server your username
      socket.emit('add user', username);
    }
  }

  // Sends a chat message
  const sendMessage = () => {
    var message = $inputMessage.val();
    // Prevent markup from being injected into the message
    message = cleanInput(message);
    // if there is a non-empty message and a socket connection
    if (message && connected) {
      $inputMessage.val('');
      var messageLower = message.toLowerCase().trim();
      
      // Handle vote confirmation
      if (isVoting && pendingVote !== null) {
        if (messageLower === 'y') {
          // Confirm and submit the pending vote
          socket.emit('submit vote', {
            vote: pendingVote
          });
          log('You voted: ' + (pendingVote === 'y' ? 'Approve' : 'Reject'), {
            prepend: false
          });
          pendingVote = null;
          isVoting = false;
          return;
        } else if (messageLower === 'n') {
          // Cancel the vote, go back to initial vote state
          pendingVote = null;
          log('Vote cancelled. Vote on team ("y" to approve / "n" to reject)', {
            prepend: false
          });
          return;
        } else {
          // Reject invalid input during vote confirmation
          log('Please respond with "y" or "n"', {
            prepend: false
          });
          return;
        }
      }
      
      // Handle initial vote (approve/reject)
      if (isVoting && pendingVote === null) {
        if (messageLower === 'y' || messageLower === 'n') {
          // Store the vote and request confirmation
          pendingVote = messageLower;
          log('You selected: ' + (messageLower === 'y' ? 'Approve' : 'Reject') + '. Confirm? ("y"/"n")', {
            prepend: false
          });
          return;
        } else {
          // Reject invalid input during voting
          log('Please respond with "y" to approve or "n" to reject', {
            prepend: false
          });
          return;
        }
      }
      
      // Handle team selection confirmation
      if (isSelectingTeam && username === connectedUsers[0] && messageLower === 'y') {
        if (selectedTeam.length === requiredTeamSize) {
          // Confirm team selection
          socket.emit('confirm team', {
            team: selectedTeam
          });
          
          log('Team confirmed: ' + selectedTeam.join(', '), {
            prepend: false
          });
          
          // Reset team selection state
          isSelectingTeam = false;
          selectedTeam = [];
          $('.teamPreview').remove();
          updatePlayerCircle();
        } else {
          log('Please select exactly ' + requiredTeamSize + ' players before confirming.', {
            prepend: false
          });
        }
        return;
      }
      
      addChatMessage({
        username: username,
        message: message
      });
      // tell server to execute 'new message' and send along one parameter
      socket.emit('new message', message);
    }
  }

  // Log a message
    const log = (message, options) => {
    var $el = $('<li>').addClass('log').text(message);
    addMessageElement($el, options);
  }

  // Adds the visual chat message to the message list
  const addChatMessage = (data, options) => {
    // Don't fade the message in if there is an 'X was typing'
    var $typingMessages = getTypingMessages(data);
    options = options || {};
    if ($typingMessages.length !== 0) {
      options.fade = false;
      $typingMessages.remove();
    }

    var $usernameDiv = $('<span class="username"/>')
      .text(data.username)
      .css('color', getUsernameColor(data.username));
    var $messageBodyDiv = $('<span class="messageBody">')
      .text(data.message);

    var typingClass = data.typing ? 'typing' : '';
    var $messageDiv = $('<li class="message"/>')
      .data('username', data.username)
      .addClass(typingClass)
      .append($usernameDiv, $messageBodyDiv);

    addMessageElement($messageDiv, options);
  }

  // Adds the visual chat typing message
  const addChatTyping = (data) => {
    data.typing = true;
    data.message = 'is typing';
    addChatMessage(data);
  }

  // Removes the visual chat typing message
  const removeChatTyping = (data) => {
    getTypingMessages(data).fadeOut(function () {
      $(this).remove();
    });
  }

  // Adds a message element to the messages and scrolls to the bottom
  // el - The element to add as a message
  // options.fade - If the element should fade-in (default = true)
  // options.prepend - If the element should prepend
  //   all other messages (default = false)
  const addMessageElement = (el, options) => {
    var $el = $(el);

    // Setup default options
    if (!options) {
      options = {};
    }
    if (typeof options.fade === 'undefined') {
      options.fade = true;
    }
    if (typeof options.prepend === 'undefined') {
      options.prepend = false;
    }

    // Apply options
    if (options.fade) {
      $el.hide().fadeIn(FADE_TIME);
    }
    if (options.prepend) {
      $messages.prepend($el);
    } else {
      $messages.append($el);
    }
    $messages[0].scrollTop = $messages[0].scrollHeight;
  }

  // Prevents input from having injected markup
  const cleanInput = (input) => {
    return $('<div/>').text(input).html();
  }

  // Updates the typing event
  const updateTyping = () => {
    if (connected) {
      if (!typing) {
        typing = true;
        socket.emit('typing');
      }
      lastTypingTime = (new Date()).getTime();

      setTimeout(() => {
        var typingTimer = (new Date()).getTime();
        var timeDiff = typingTimer - lastTypingTime;
        if (timeDiff >= TYPING_TIMER_LENGTH && typing) {
          socket.emit('stop typing');
          typing = false;
        }
      }, TYPING_TIMER_LENGTH);
    }
  }

  // Gets the 'X is typing' messages of a user
  const getTypingMessages = (data) => {
    return $('.typing.message').filter(function (i) {
      return $(this).data('username') === data.username;
    });
  }

  // Gets the color of a username through our hash function
  const getUsernameColor = (username) => {
    // Compute hash code
    var hash = 7;
    for (var i = 0; i < username.length; i++) {
       hash = username.charCodeAt(i) + (hash << 5) - hash;
    }
    // Calculate color
    var index = Math.abs(hash % COLORS.length);
    return COLORS[index];
  }

  // Keyboard events

  $window.keydown(event => {
    // Auto-focus the current input when a key is typed
    if (!(event.ctrlKey || event.metaKey || event.altKey)) {
      $currentInput.focus();
    }
    // When the client hits ENTER on their keyboard
    if (event.which === 13) {
      if (username) {
        sendMessage();
        socket.emit('stop typing');
        typing = false;
      } else {
        setUsername();
      }
    }
  });

  $inputMessage.on('input', () => {
    updateTyping();
  });

  // Click events

  // Focus input when clicking anywhere on login page
  $loginPage.click(() => {
    $currentInput.focus();
  });

  // Focus input when clicking on the message input's border
  $inputMessage.click(() => {
    $inputMessage.focus();
  });

  // Socket events

  // Whenever the server emits 'login', log the login message
  socket.on('login', (data) => {
    connected = true;
    // Display the welcome message
    var message = "Welcome, " + username;
    log(message, {
      prepend: false
    });
    addParticipantsMessage(data);
    // Initialize quest tokens
    initializeQuestTokens();
    // Request current user list from server
    socket.emit('get users');
  });

  // Whenever the server emits 'new message', update the chat body
  socket.on('new message', (data) => {
    addChatMessage(data);
  });

  // Whenever the server emits 'user joined', log it in the chat body
  socket.on('user joined', (data) => {
    log(data.username + ' joined');
    addParticipantsMessage(data);
    // Request updated user list
    socket.emit('get users');
  });

  // Whenever the server emits 'user left', log it in the chat body
  socket.on('user left', (data) => {
    log(data.username + ' left');
    addParticipantsMessage(data);
    removeChatTyping(data);
    // Request updated user list
    socket.emit('get users');
  });

  // Whenever the server emits 'typing', show the typing message
  socket.on('typing', (data) => {
    addChatTyping(data);
  });

  // Whenever the server emits 'stop typing', kill the typing message
  socket.on('stop typing', (data) => {
    removeChatTyping(data);
  });

  socket.on('disconnect', () => {
    log('you have been disconnected');
  });

  socket.on('reconnect', () => {
    log('you have been reconnected');
    if (username) {
      socket.emit('add user', username);
    }
  });

  socket.on('reconnect_error', () => {
    log('attempt to reconnect has failed');
  });

  // Whenever the server emits 'role assigned', show the role to the player
  socket.on('role assigned', (data) => {
    // Remove previous role assignment messages for this player
    $('.messages .role-assignment-message').remove();
    
    var $message = $('<li class="log role-assignment-message">Role: ' + cleanInput(data.role) + '</li>');
    addMessageElement($message, {
      prepend: false
    });
    
    // Add reveal information if available
    if (data.reveal !== undefined) {
      var $revealMessage = $('<li class="log role-assignment-message">Reveal: ' + cleanInput(data.reveal) + '</li>');
      addMessageElement($revealMessage, {
        prepend: false
      });
    }
  });

  // Whenever the server emits 'user list', update the connected users
  socket.on('user list', (data) => {
    connectedUsers = data.users || [];
    updateRoleAssignmentUI();
    updatePlayerCircle();
    initializeQuestTokens(); // Update quest sizes based on number of players
    
    // Update team preview if team selection is active
    if (isSelectingTeam && username === connectedUsers[0]) {
      updateTeamPreview();
    }
  });

  // Whenever the server emits 'role sets updated', sync the role sets
  socket.on('role sets updated', (data) => {
    if (data.roleSets && Array.isArray(data.roleSets)) {
      roleSets = data.roleSets;
      updateRoleAssignmentUI();
    }
  });

  // Handle team selection request from server
  socket.on('request team selection', (data) => {
    if (data.questIndex) {
      requestTeamSelection(data.questIndex);
    }
  });

  // Handle team selected confirmation
  socket.on('team selected', (data) => {
    if (data.leader && data.team) {
      log(data.leader + ' selected team: ' + data.team.join(', '), {
        prepend: false
      });
      
      // Reset team selection state if we were selecting
      if (isSelectingTeam && username === connectedUsers[0]) {
        isSelectingTeam = false;
        selectedTeam = [];
        $('.teamPreview').remove();
        updatePlayerCircle();
      }
    }
  });

  // Handle vote request
  socket.on('request vote', (data) => {
    if (data.team && data.leader) {
      isVoting = true;
      pendingVote = null; // Reset any pending vote
      log('Vote on team: ' + data.team.join(', ') + ' ("y"/"n")', {
        prepend: false
      });
    }
  });

  // Handle vote result
  socket.on('vote result', (data) => {
    if (data.approved !== undefined) {
      // Reset voting state
      isVoting = false;
      pendingVote = null;
      
      // Display individual votes
      var approveText = 'Approve: ' + (data.approveVoters && data.approveVoters.length > 0 ? data.approveVoters.join(', ') : 'None');
      var rejectText = 'Reject: ' + (data.rejectVoters && data.rejectVoters.length > 0 ? data.rejectVoters.join(', ') : 'None');
      
      log(approveText, {
        prepend: false
      });
      log(rejectText, {
        prepend: false
      });
      
      var resultText = 'Vote result: ';
      if (data.approved) {
        resultText += 'APPROVED (' + data.approveCount + ' approve, ' + data.rejectCount + ' reject). Mission ' + currentQuestIndex + ' begins!';
        log(resultText, {
          prepend: false
        });
        
        // Increment quest token
        incrementQuestToken();
        
        // Reset vote track to 1 for next quest
        currentVoteTrack = 1;
        initializeVoteTrack();
        
        // Rotate leader (server handles this, wait for user list update)
        // After user list updates, request team selection for next quest
        setTimeout(function() {
          if (currentQuestIndex <= 5) {
            socket.emit('start team selection', {
              questIndex: currentQuestIndex
            });
          }
        }, 1500); // Wait for user list to update
      } else {
        resultText += 'REJECTED (' + data.approveCount + ' approve, ' + data.rejectCount + ' reject).';
        log(resultText, {
          prepend: false
        });
        
        // Increment vote track
        incrementVoteTrack();
        
        // Rotate leader
        rotateLeader();
        
        // If vote track hasn't reached 5, request new team selection
        if (currentVoteTrack <= 5) {
          setTimeout(function() {
            socket.emit('start team selection', {
              questIndex: currentQuestIndex
            });
          }, 1000);
        } else {
          log('Vote track reached 5. Game over - spies win!', {
            prepend: false
          });
        }
      }
    }
  });

});
