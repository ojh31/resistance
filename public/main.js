$(function() {
  var FADE_TIME = 150; // ms
  var TYPING_TIMER_LENGTH = 400; // ms
  var COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45',
    '#e6beff', '#469990'
  ];

  // Initialize variables
  var $window = $(window);
  var $usernameInput = $('.usernameInput'); // Input for username
  var $messages = $('.messages'); // Messages area
  var $actionButtons = $('#actionButtons'); // Action buttons container

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
    'Servant', 'Minion','Merlin', 'Percival', 'Morgana',
    'Mordred', 'Oberon', 'Merlin Pure', 'Tristan', 'Isolde',
    'Brute',
  ];
  
  // Role descriptions for tooltips
  var roleDescriptions = {
    'Servant': 'Good team member with no special abilities.',
    'Minion': 'Basic evil team member, knows teammates.',
    'Merlin': 'Good team. Sees all evil players except Mordred.',
    'Percival': 'Good team. Sees Merlin and Morgana, but cannot tell which is which.',
    'Morgana': 'Evil team. Appears as Merlin to Percival.',
    'Mordred': 'Evil team. Invisible to Merlin. Sees other evil players.',
    'Oberon': 'Evil team. Does not know other evil players, and they do not know him.',
    'Merlin Pure': 'Good team. Sees the exact role of every player.',
    'Tristan': 'Good team. Knows who Isolde is.',
    'Isolde': 'Good team. Knows who Tristan is.',
    'Brute': 'Evil team. Cannot fail quests 4 and 5.'
  };
  var $playerRoles = $('#playerRoles');
  var $assignButton = $('#assignButton');
  var $playerCircleContainer = $('#playerCircleContainer');
  var $questTokensContainer = $('#questTokensContainer');
  var $collapseButton = $('#collapseButton');
  var $roleAssignmentContent = $('.roleAssignmentContent');
  var roleAssignmentCollapsed = false;

  // Role sets state - array of role set objects, each is {username: role}
  var roleSets = [{}]; // Start with one empty role set
  
  // Suggested role sets for 5 players (array of role arrays)
  var suggestedRoleSets = [
    ['Merlin', 'Percival', 'Servant', 'Morgana', 'Minion'],
    ['Merlin', 'Tristan', 'Isolde', 'Minion', 'Minion'],
    ['Servant', 'Tristan', 'Isolde', 'Oberon', 'Minion'],
    ['Merlin Pure', 'Percival', 'Servant', 'Morgana', 'Minion'],
    ['Merlin', 'Servant', 'Servant', 'Morgana', 'Oberon']
  ];
  var suggestedRoleSetIndex = 0; // Track which suggested set to use next
  var prefillSuggested = false; // Track checkbox state
  
  // Team selection state
  var isSelectingTeam = false;
  var selectedTeam = [];
  var requiredTeamSize = 0;
  var currentQuestIndex = 1;
  
  // Voting state
  var isVoting = false;
  var pendingVote = null; // Stores the vote ('y' or 'n') waiting for confirmation
  var currentVoteTrack = 1;
  var voteTrackAtRequest = 1; // Track the vote track number when vote was requested
  
  // Quest voting state
  var isQuestVoting = false;
  var pendingQuestVote = null; // Stores the quest vote ('y' or 'n') waiting for confirmation
  
  // Quest results tracking: {questIndex: 'success'|'fail'}
  var questResults = {};
  
  // Vote history tracking: {questIndex: [{voteTrack, team, leader, approveVoters, rejectVoters, approved}]}
  var voteHistory = {};
  
  // Quest mission history tracking: {questIndex: {team, successCount, failCount, questSucceeded}}
  var questMissionHistory = {};
  
  // Assassin phase state
  var isAssassinPhase = false;
  var pendingAssassinGuess = null; // Stores the assassin guess waiting for confirmation
  var goodTeamPlayers = []; // List of good team players (only these can be guessed)

  // Personal rename mappings: {originalName: renamedName}
  var personalRenames = {};
  
  // Load personal renames from localStorage on page load
  try {
    var storedRenames = localStorage.getItem('personalRenames');
    if (storedRenames) {
      personalRenames = JSON.parse(storedRenames);
    }
  } catch (e) {
    // If localStorage fails, start with empty object
    personalRenames = {};
  }
  
  // Function to save personal renames to localStorage
  var savePersonalRenames = function() {
    try {
      localStorage.setItem('personalRenames', JSON.stringify(personalRenames));
    } catch (e) {
      // If localStorage fails, silently continue
    }
  };

  // Action buttons management
  const showActionButtons = (buttons) => {
    // Stop any ongoing animations and immediately show
    $actionButtons.stop(true, true).empty();
    
    buttons.forEach(function(button) {
      var $button = $('<button class="actionButton">')
        .text(button.text)
        .addClass(button.class || '')
        .css({
          backgroundColor: button.color || '#4CAF50',
          color: '#fff',
          border: 'none',
          padding: '15px 30px',
          fontSize: '16px',
          fontWeight: '700',
          cursor: 'pointer',
          borderRadius: '8px',
          margin: '5px',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        });
      
      $button.on('mouseenter', function() {
        $(this).css({
          transform: 'scale(1.05)',
          boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
        });
      });
      
      $button.on('mouseleave', function() {
        $(this).css({
          transform: 'scale(1)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        });
      });
      
      $button.on('click', button.handler);
      $actionButtons.append($button);
    });
    
    $actionButtons.fadeIn(200);
  };

  const hideActionButtons = () => {
    // Stop any ongoing animations and immediately hide
    $actionButtons.stop(true, true).fadeOut(200, function() {
      $(this).empty();
    });
  };

  const updateActionButtons = () => {
    // Show buttons based on current game state
    // (hideActionButtons will be called if no buttons should be shown)
    
    // Quest vote confirmation
    if (isQuestVoting && pendingQuestVote !== null) {
      showActionButtons([
        {
          text: 'Confirm',
          color: '#4CAF50',
          handler: function() {
            socket.emit('submit quest vote', {
              vote: pendingQuestVote
            });
            log('You voted: ' + (pendingQuestVote === 'y' ? 'Success' : 'Fail'), {
              prepend: false,
              color: pendingQuestVote === 'y' ? '#4CAF50' : '#f44336'
            });
            pendingQuestVote = null;
            isQuestVoting = false;
            hideActionButtons();
          }
        },
        {
          text: 'Cancel',
          color: '#f44336',
          handler: function() {
            pendingQuestVote = null;
            log('Quest vote cancelled. You were selected for quest ' + currentQuestIndex + '. Succeed or Fail?', {
              prepend: false
            });
            updateActionButtons(); // Refresh buttons to show succeed/fail
          }
        }
      ]);
      return;
    }
    
    // Initial quest vote (succeed/fail)
    if (isQuestVoting && pendingQuestVote === null) {
      showActionButtons([
        {
          text: 'Succeed',
          color: '#4CAF50',
          handler: function() {
            pendingQuestVote = 'y';
            log('You have selected Success. Confirm?', {
              prepend: false,
              color: '#4CAF50'
            });
            updateActionButtons(); // Refresh buttons to show confirm/cancel
          }
        },
        {
          text: 'Fail',
          color: '#f44336',
          handler: function() {
            pendingQuestVote = 'n';
            log('You have selected Fail. Confirm?', {
              prepend: false,
              color: '#f44336'
            });
            updateActionButtons(); // Refresh buttons to show confirm/cancel
          }
        }
      ]);
      return;
    }
    
    // Vote confirmation
    if (isVoting && pendingVote !== null) {
      showActionButtons([
        {
          text: 'Confirm',
          color: '#4CAF50',
          handler: function() {
            socket.emit('submit vote', {
              vote: pendingVote
            });
            log('You voted: ' + (pendingVote === 'y' ? 'Approve' : 'Reject'), {
              prepend: false,
              color: pendingVote === 'y' ? '#4CAF50' : '#f44336'
            });
            pendingVote = null;
            isVoting = false;
            hideActionButtons();
          }
        },
        {
          text: 'Cancel',
          color: '#f44336',
          handler: function() {
            pendingVote = null;
            log('Vote cancelled. Vote on team:', {
              prepend: false
            });
            updateActionButtons(); // Refresh buttons to show approve/reject
          }
        }
      ]);
      return;
    }
    
    // Initial vote (approve/reject)
    if (isVoting && pendingVote === null) {
      showActionButtons([
        {
          text: 'Approve',
          color: '#4CAF50',
          handler: function() {
            pendingVote = 'y';
            log('You selected: Approve. Confirm?', {
              prepend: false,
              color: '#4CAF50'
            });
            updateActionButtons(); // Refresh buttons to show confirm/cancel
          }
        },
        {
          text: 'Reject',
          color: '#f44336',
          handler: function() {
            pendingVote = 'n';
            log('You selected: Reject. Confirm?', {
              prepend: false,
              color: '#f44336'
            });
            updateActionButtons(); // Refresh buttons to show confirm/cancel
          }
        }
      ]);
      return;
    }
    
    // Assassin guess confirmation
    if (isAssassinPhase && pendingAssassinGuess !== null) {
      showActionButtons([
        {
          text: 'Confirm Guess',
          color: '#f44336',
          handler: function() {
            socket.emit('submit assassin guess', {
              guess: pendingAssassinGuess
            });
            log('You guessed: ' + pendingAssassinGuess, {
              prepend: false,
              color: '#f44336'
            });
            pendingAssassinGuess = null;
            isAssassinPhase = false;
            hideActionButtons();
            updatePlayerCircle();
          }
        },
        {
          text: 'Cancel',
          color: '#666',
          handler: function() {
            pendingAssassinGuess = null;
            log('Assassin guess cancelled. Click on a good team player name in the circle above to make your guess.', {
              prepend: false
            });
            updatePlayerCircle();
            updateActionButtons(); // Show message again
          }
        }
      ]);
      return;
    }
    
    // Assassin phase - waiting for player selection
    if (isAssassinPhase && pendingAssassinGuess === null) {
      // Show message to select a player
      var $message = $('<div class="actionButtonMessage">Click on a good team player to make your guess</div>');
      $actionButtons.stop(true, true).empty().append($message);
      $actionButtons.fadeIn(200);
      return;
    }
    
    // Team selection confirmation
    if (isSelectingTeam && username === connectedUsers[0]) {
      if (selectedTeam.length === requiredTeamSize) {
        showActionButtons([
          {
            text: 'Confirm Team',
            color: '#4CAF50',
            handler: function() {
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
              hideActionButtons();
            }
          },
          {
            text: 'Cancel',
            color: '#f44336',
            handler: function() {
              // Cancel team selection - reset state
              isSelectingTeam = false;
              selectedTeam = [];
              $('.teamPreview').remove();
              updatePlayerCircle();
              hideActionButtons();
            }
          }
        ]);
      } else {
        // Show message that team is incomplete
        var $message = $('<div class="actionButtonMessage">Select ' + (requiredTeamSize - selectedTeam.length) + ' more player(s)</div>');
        $actionButtons.empty().append($message);
        $actionButtons.fadeIn(200);
      }
      return;
    }
    
    // If we reach here, no buttons should be shown
    hideActionButtons();
  };

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
      
      // Apply personal rename for display
      var displayName = applyPersonalRename(user);
      
      // Create player item
      var $playerItem = $('<div class="playerCircleItem"></div>')
        .text(displayName)
        .css({
          left: x + 'px',
          top: y + 'px',
          backgroundColor: getUsernameColor(user),
          color: '#fff'
        })
        .data('username', user);
      
      // Add right-click handler for renaming
      $playerItem.on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showRenamePrompt(user, displayName);
      });
      
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
          
          // Update action buttons
          updateActionButtons();
        });
      }
      
      // Make clickable if assassin phase is active (only when no guess is pending)
      // Only make good team players clickable
      if (isAssassinPhase && pendingAssassinGuess === null && goodTeamPlayers.indexOf(user) !== -1) {
        $playerItem.addClass('clickable');
        $playerItem.css('cursor', 'pointer');
        
        // Add click handler for assassin guess
        $playerItem.on('click', function() {
          var clickedUser = $(this).data('username');
          
          // Validate that clicked player is on good team
          if (goodTeamPlayers.indexOf(clickedUser) === -1) {
            log('You can only guess players on the good team.', {
              prepend: false,
              color: '#f44336'
            });
            return;
          }
          
          // Only allow clicking if no guess is pending
          if (pendingAssassinGuess === null) {
            // Store the guess immediately to prevent multiple selections
            pendingAssassinGuess = clickedUser;
            
            // Immediately disable all click handlers to prevent rapid clicking
            $('.playerCircleItem').off('click').removeClass('clickable').css('cursor', 'default');
            
            log('You guessed: ' + clickedUser + '. Confirm?', {
              prepend: false,
              color: '#f44336'
            });
            
            // Update player circle to show selection
            updatePlayerCircle();
            
            // Show action buttons for confirmation
            updateActionButtons();
          }
        });
      }
      
      // Gray out evil team players during assassin phase
      if (isAssassinPhase && goodTeamPlayers.length > 0 && goodTeamPlayers.indexOf(user) === -1) {
        $playerItem.css('opacity', '0.5');
        $playerItem.css('cursor', 'not-allowed');
      }
      
      // Highlight if this is the pending assassin guess
      if (isAssassinPhase && pendingAssassinGuess === user) {
        $playerItem.addClass('selected');
        $playerItem.css('border', '3px solid #f44336');
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

  // Generate tooltip text for a quest tile
  const getQuestTooltip = (questIndex) => {
    var tooltipParts = [];
    
    // Add vote history
    if (voteHistory[questIndex] && voteHistory[questIndex].length > 0) {
      voteHistory[questIndex].forEach(function(vote, index) {
        tooltipParts.push('Vote ' + vote.voteTrack + ':');
        // Apply personal renames to team members
        var renamedTeam = vote.team.length > 0 ? vote.team.map(function(member) {
          return applyPersonalRename(member);
        }).join(', ') : 'None';
        tooltipParts.push('  Team: ' + renamedTeam);
        tooltipParts.push('  Leader: ' + (vote.leader ? applyPersonalRename(vote.leader) : 'None'));
        if (vote.approveVoters.length > 0) {
          var renamedApproveVoters = vote.approveVoters.map(function(voter) {
            return applyPersonalRename(voter);
          }).join(', ');
          tooltipParts.push('  Approve: ' + renamedApproveVoters + ' (' + vote.approveCount + ')');
        }
        if (vote.rejectVoters.length > 0) {
          var renamedRejectVoters = vote.rejectVoters.map(function(voter) {
            return applyPersonalRename(voter);
          }).join(', ');
          tooltipParts.push('  Reject: ' + renamedRejectVoters + ' (' + vote.rejectCount + ')');
        }
        tooltipParts.push('  Result: ' + (vote.approved ? 'APPROVED' : 'REJECTED'));
      });
    }
    
    // Add mission result
    if (questMissionHistory[questIndex]) {
      var mission = questMissionHistory[questIndex];
      // Add newline before Mission Result if there's vote history above
      if (tooltipParts.length > 0) {
        tooltipParts.push('\nMission Result:');
      } else {
        tooltipParts.push('Mission Result:');
      }
      // Apply personal renames to mission team members
      var renamedMissionTeam = mission.team.length > 0 ? mission.team.map(function(member) {
        return applyPersonalRename(member);
      }).join(', ') : 'None';
      tooltipParts.push('  Team: ' + renamedMissionTeam);
      tooltipParts.push('  Success: ' + mission.successCount);
      tooltipParts.push('  Fail: ' + mission.failCount);
      tooltipParts.push('  Outcome: ' + (mission.questSucceeded ? 'SUCCESS' : 'FAIL'));
    } else if (questResults[questIndex]) {
      // If we have a result but no detailed history, show at least the outcome
      // Add newline before Mission Result if there's vote history above
      if (tooltipParts.length > 0) {
        tooltipParts.push('\nMission Result:');
      } else {
        tooltipParts.push('Mission Result:');
      }
      tooltipParts.push('  Outcome: ' + (questResults[questIndex] === 'success' ? 'SUCCESS' : 'FAIL'));
    }
    
    return tooltipParts.join('\n');
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
      
      // Add success/fail styling based on quest results
      if (questResults[i] === 'success') {
        $questToken.addClass('success');
      } else if (questResults[i] === 'fail') {
        $questToken.addClass('fail');
      }
      
      // Add custom tooltip with vote and mission history
      var tooltipText = getQuestTooltip(i);
      if (tooltipText && tooltipText.trim() !== '') {
        // Only show tooltip if there's actual history to display
        var $tooltip = $('<div class="questTokenTooltip"></div>')
          .text(tooltipText);
        $questToken.append($tooltip);
        // Enable pointer events for tooltip hover
        $questToken.css('cursor', 'help');
      }
      
      $questTokens.append($questToken);
    }
    
    $questTokensContainer.append($questTokens);
    
    // Initialize vote track underneath quest tokens
    initializeVoteTrack();
  };

  // Find vote data for a specific vote track number
  const findVoteByTrack = (voteTrackNumber) => {
    // Search through all quests' vote histories to find the vote with matching voteTrack
    for (var questIndex in voteHistory) {
      if (voteHistory[questIndex] && Array.isArray(voteHistory[questIndex])) {
        for (var i = 0; i < voteHistory[questIndex].length; i++) {
          if (voteHistory[questIndex][i].voteTrack === voteTrackNumber) {
            return voteHistory[questIndex][i];
          }
        }
      }
    }
    return null;
  };

  // Generate tooltip text for a vote track tile
  const getVoteTrackTooltip = (voteTrackNumber) => {
    var vote = findVoteByTrack(voteTrackNumber);
    if (!vote) {
      return null;
    }
    
    var tooltipParts = [];
    // Apply personal renames to team members
    var renamedTeam = vote.team.length > 0 ? vote.team.map(function(member) {
      return applyPersonalRename(member);
    }).join(', ') : 'None';
    tooltipParts.push('Team: ' + renamedTeam);
    tooltipParts.push('Leader: ' + (vote.leader ? applyPersonalRename(vote.leader) : 'None'));
    if (vote.approveVoters.length > 0) {
      var renamedApproveVoters = vote.approveVoters.map(function(voter) {
        return applyPersonalRename(voter);
      }).join(', ');
      tooltipParts.push('Approve: ' + renamedApproveVoters + ' (' + vote.approveCount + ')');
    }
    if (vote.rejectVoters.length > 0) {
      var renamedRejectVoters = vote.rejectVoters.map(function(voter) {
        return applyPersonalRename(voter);
      }).join(', ');
      tooltipParts.push('Reject: ' + renamedRejectVoters + ' (' + vote.rejectCount + ')');
    }
    tooltipParts.push('Result: ' + (vote.approved ? 'APPROVED' : 'REJECTED'));
    
    return tooltipParts.join('\n');
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
      
      // Add tooltip if vote data exists for this vote track
      var tooltipText = getVoteTrackTooltip(i);
      if (tooltipText) {
        var $tooltip = $('<div class="voteTrackTileTooltip"></div>')
          .text(tooltipText);
        $voteTile.append($tooltip);
        $voteTile.css('cursor', 'help');
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
  const requestTeamSelection = (questIndex, requiredTeamSizeFromServer) => {
    if (connectedUsers.length === 0) return;
    
    var leader = connectedUsers[0];
    
    // Use server-provided team size (single source of truth)
    // Fall back to client calculation only if server didn't provide it (backward compatibility)
    var questSize;
    if (requiredTeamSizeFromServer !== undefined) {
      questSize = requiredTeamSizeFromServer;
    } else {
      var numPlayers = connectedUsers.length;
      if (numPlayers < 5) numPlayers = 5;
      if (numPlayers > 10) numPlayers = 10;
      questSize = getQuestSize(questIndex, numPlayers);
    }
    
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
      log('You are the leader. Select a team of ' + questSize + ' players for Quest ' + questIndex + '. Click on player tiles to select them, then confirm with the button.', {
        prepend: false
      });
      
      // Update player circle to make tiles clickable
      updatePlayerCircle();
      
      // Show initial preview
      updateTeamPreview();
      
      // Show action buttons
      updateActionButtons();
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
      // Apply personal renames to team member names
      var renamedTeam = selectedTeam.map(function(member) {
        return applyPersonalRename(member);
      });
      previewText += renamedTeam.join(', ');
    }
    
    var $preview = $('<li class="log teamPreview">' + previewText + '</li>');
    addMessageElement($preview, {
      prepend: false
    });
  };

  // Track open dropdowns to prevent interruption during collaboration
  var openDropdowns = {}; // {username_roleSetIndex: true}
  
  // Update the role assignment UI
  const updateRoleAssignmentUI = () => {
    // Save the state of all open/focused dropdowns before clearing
    var savedDropdownStates = {};
    var $allSelects = $('#playerRoles select');
    
    $allSelects.each(function() {
      var $select = $(this);
      var username = $select.attr('data-username');
      var roleSetIndex = parseInt($select.attr('data-role-set-index'));
      var key = username + '_' + roleSetIndex;
      
      // Check if this dropdown is currently open (focused or has mouse over)
      var isFocused = document.activeElement === this[0];
      var isOpen = isFocused || openDropdowns[key];
      
      if (isOpen) {
        savedDropdownStates[key] = {
          username: username,
          roleSetIndex: roleSetIndex,
          value: $select.val(),
          isFocused: isFocused
        };
        // Keep it marked as open
        openDropdowns[key] = true;
      }
    });
    
    $playerRoles.empty();
    
    // Create a row for each role set
    roleSets.forEach(function(roleSet, roleSetIndex) {
      var $roleSetRow = $('<div class="roleSetRow"></div>');
      
      // Add delete button on the left side (only if there's more than one role set)
      if (roleSets.length > 1) {
        var $deleteButton = $('<button class="deleteRoleSetButton">×</button>')
          .attr('data-role-set-index', roleSetIndex)
          .attr('title', 'Delete role set');
        
        $deleteButton.on('click', function() {
          var index = parseInt($(this).attr('data-role-set-index'));
          socket.emit('delete role set', {
            roleSetIndex: index
          });
        });
        
        $roleSetRow.append($deleteButton);
      }
      
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
          var $option = $('<option></option>')
            .attr('value', role)
            .text(role)
            .attr('title', roleDescriptions[role] || '');
          // Mark as selected if this role is already selected for this user in this role set
          if (roleSet[user] === role) {
            $option.attr('selected', 'selected');
          }
          $option.appendTo($roleSelect);
        });
        
        // Set initial title based on selected role
        var initialRole = roleSet[user] || '';
        if (initialRole && roleDescriptions[initialRole]) {
          $roleSelect.attr('title', roleDescriptions[initialRole]);
        }
        
        // Track dropdown open/close state
        var dropdownKey = user + '_' + roleSetIndex;
        
        // Handle dropdown focus - mark as open
        $roleSelect.on('focus', function() {
          openDropdowns[dropdownKey] = true;
        });
        
        // Handle dropdown blur - mark as closed after a short delay
        // This delay allows for clicks on options to register
        $roleSelect.on('blur', function() {
          setTimeout(function() {
            // Only mark as closed if it's not focused again
            if (document.activeElement !== $roleSelect[0]) {
              openDropdowns[dropdownKey] = false;
            }
          }, 200);
        });
        
        // Handle dropdown change - sync with server
        $roleSelect.on('change', function() {
          var selectedRole = $(this).val();
          var username = $(this).attr('data-username');
          var index = parseInt($(this).attr('data-role-set-index'));
          
          // Update title attribute with role description
          if (selectedRole && roleDescriptions[selectedRole]) {
            $(this).attr('title', roleDescriptions[selectedRole]);
          } else {
            $(this).attr('title', '');
          }
          
          // Emit change to server
          socket.emit('role selection changed', {
            roleSetIndex: index,
            username: username,
            role: selectedRole || ''
          });
        });
        
        $playerItem.append($roleSelect);
        $roleSetRow.append($playerItem);
        
        // Restore state if this dropdown was previously open
        var savedState = savedDropdownStates[dropdownKey];
        if (savedState) {
          var serverValue = roleSet[user] || '';
          
          // If the dropdown was open, preserve its value unless server changed it
          if (savedState.isFocused) {
            // If server value matches what user was selecting, keep it
            // Otherwise, use server value (another user changed it)
            if (savedState.value === serverValue) {
              $roleSelect.val(savedState.value);
            } else {
              // Server value changed - update it but try to preserve focus
              $roleSelect.val(serverValue);
            }
            // Restore focus after a brief delay to ensure DOM is ready
            setTimeout(function() {
              $roleSelect.focus();
            }, 0);
          } else if (openDropdowns[dropdownKey]) {
            // Dropdown was marked as open but not focused - preserve value
            if (savedState.value === serverValue) {
              $roleSelect.val(savedState.value);
            } else {
              $roleSelect.val(serverValue);
            }
          } else {
            // Dropdown wasn't open - use server value
            $roleSelect.val(serverValue);
          }
        } else {
          // No saved state - use server value
          var serverValue = roleSet[user] || '';
          $roleSelect.val(serverValue);
        }
      });
      
      $playerRoles.append($roleSetRow);
    });
    
    // Add "Add Role Set" button and checkbox after the last role set row
    var $addRoleSetContainer = $('<div class="addRoleSetContainer"></div>');
    
    var $addRoleSetButton = $('<button class="addRoleSetButton" id="addRoleSetButton">Add Role Set</button>');
    $addRoleSetButton.on('click', function() {
      // Check if prefill is enabled and there are remaining suggested sets
      var shouldPrefill = prefillSuggested && suggestedRoleSetIndex < suggestedRoleSets.length;
      var prefillData = null;
      
      if (shouldPrefill && connectedUsers.length >= 5) {
        // Get the next suggested role set
        var suggestedRoles = suggestedRoleSets[suggestedRoleSetIndex];
        // Map roles to first 5 connected users
        prefillData = {};
        for (var i = 0; i < 5 && i < connectedUsers.length; i++) {
          prefillData[connectedUsers[i]] = suggestedRoles[i];
        }
        suggestedRoleSetIndex++; // Move to next suggested set
      }
      
      socket.emit('add role set', {
        prefill: prefillData
      });
    });
    $addRoleSetContainer.append($addRoleSetButton);
    
    // Add checkbox for "Prefill Suggested"
    var $prefillCheckbox = $('<input type="checkbox" id="prefillSuggestedCheckbox">');
    
    // Check if there are remaining suggested role sets and at least 5 players
    var hasRemainingSuggestions = suggestedRoleSetIndex < suggestedRoleSets.length && connectedUsers.length >= 5;
    
    // If no remaining suggestions, disable and uncheck
    if (!hasRemainingSuggestions) {
      prefillSuggested = false;
    }
    
    $prefillCheckbox.prop('checked', prefillSuggested);
    $prefillCheckbox.prop('disabled', !hasRemainingSuggestions);
    
    $prefillCheckbox.on('change', function() {
      if (!$(this).prop('disabled')) {
        prefillSuggested = $(this).prop('checked');
      }
    });
    
    var $prefillLabel = $('<label for="prefillSuggestedCheckbox">Prefill Suggested</label>');
    var $prefillContainer = $('<span class="prefillSuggestedContainer"></span>');
    
    // Add disabled class if no remaining suggestions
    if (!hasRemainingSuggestions) {
      $prefillContainer.addClass('disabled');
    }
    
    $prefillContainer.append($prefillCheckbox);
    $prefillContainer.append($prefillLabel);
    $addRoleSetContainer.append($prefillContainer);
    
    $playerRoles.append($addRoleSetContainer);
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


  // Sets username (no longer handles game actions - those use buttons)
  const setUsername = () => {
    username = cleanInput($usernameInput.val().trim());

    // If the username is valid
    if (username) {
      // Tell the server your username (don't fade out yet - wait for confirmation)
      socket.emit('add user', username);
    }
  }

  // Helper to apply personal renames to a string that may contain usernames
  const applyRenamesToString = (str) => {
    if (!str || typeof str !== 'string') {
      return str;
    }
    var result = str;
    // Replace all usernames in the string with their renamed versions
    Object.keys(personalRenames).forEach(function(originalName) {
      // Use word boundaries to match whole usernames only
      var regex = new RegExp('\\b' + originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      result = result.replace(regex, personalRenames[originalName]);
    });
    return result;
  }

  // Log a message
    const log = (message, options) => {
    // Apply personal renames to the message string
    var processedMessage = applyRenamesToString(message);
    var $el = $('<li>').addClass('log').text(processedMessage);
    // Apply color if specified in options
    if (options && options.color) {
      $el.css('color', options.color);
    }
    addMessageElement($el, options);
  }

  // Update waiting status message
  const updateWaitingStatus = (data) => {
    // Remove any existing waiting status messages
    $('.waiting-status-message').remove();
    
    if (data.waitingOn && data.waitingOn.length > 0) {
      // Apply personal renames to waiting players
      var renamedWaiting = data.waitingOn.map(function(player) {
        return applyPersonalRename(player);
      });
      var message = 'Waiting on ' + renamedWaiting.join(', ');
      
      // Add context-specific text
      if (data.context === 'vote') {
        message += ' to vote';
      } else if (data.context === 'quest vote') {
        message += ' to submit mission vote';
      } else if (data.context === 'team selection') {
        message += ' to propose team';
      } else if (data.context === 'assassin guess') {
        message += ' to guess Merlin';
      }
      
      var $waitingMessage = $('<li class="log waiting-status-message">' + message + '</li>')
        .css('color', '#FFA500'); // Orange color for waiting messages
      
      addMessageElement($waitingMessage, {
        prepend: false
      });
    }
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

    var displayUsername = applyPersonalRename(data.username);
    var $usernameDiv = $('<span class="username"/>')
      .text(displayUsername)
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

  // Apply personal rename override if it exists
  const applyPersonalRename = (originalUsername) => {
    if (!originalUsername) {
      return originalUsername;
    }
    // Check if we have a personal rename for this username
    if (personalRenames[originalUsername]) {
      return personalRenames[originalUsername];
    }
    return originalUsername;
  }

  // Show rename prompt dialog
  const showRenamePrompt = (originalUsername, currentDisplayName) => {
    // Remove any existing rename prompt
    $('.renamePrompt').remove();
    
    // Check if there's already a rename for this user
    var hasRename = personalRenames[originalUsername] !== undefined;
    var currentRename = hasRename ? personalRenames[originalUsername] : '';
    
    // Create modal overlay
    var $overlay = $('<div class="renamePromptOverlay"></div>')
      .css({
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
    
    // Create dialog
    var $dialog = $('<div class="renamePrompt"></div>')
      .css({
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        minWidth: '300px',
        maxWidth: '400px'
      });
    
    // Title
    var $title = $('<h3></h3>')
      .text('Rename Player')
      .css({
        margin: '0 0 15px 0',
        fontSize: '18px',
        fontWeight: 'bold'
      });
    $dialog.append($title);
    
    // Original name hint
    var $originalHint = $('<div></div>')
      .text('Original name: ' + originalUsername)
      .css({
        fontSize: '12px',
        color: '#666',
        marginBottom: '10px'
      });
    $dialog.append($originalHint);
    
    // Input field
    var $input = $('<input type="text" class="renameInput">')
      .val(currentDisplayName)
      .css({
        width: '100%',
        padding: '8px',
        fontSize: '14px',
        border: '1px solid #ddd',
        borderRadius: '4px',
        marginBottom: '15px',
        boxSizing: 'border-box'
      })
      .attr('maxlength', '30');
    $dialog.append($input);
    
    // Error message area
    var $errorMsg = $('<div class="renameError"></div>')
      .css({
        color: '#f44336',
        fontSize: '12px',
        marginBottom: '10px',
        minHeight: '16px',
        display: 'none'
      });
    $dialog.append($errorMsg);
    
    // Button container
    var $buttonContainer = $('<div></div>')
      .css({
        display: 'flex',
        gap: '10px',
        justifyContent: 'flex-end'
      });
    
    // Remove button (only if rename exists)
    if (hasRename) {
      var $removeBtn = $('<button class="renameRemoveBtn">Remove</button>')
        .css({
          padding: '8px 16px',
          fontSize: '14px',
          backgroundColor: '#f44336',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        })
        .on('click', function() {
          delete personalRenames[originalUsername];
          savePersonalRenames();
          refreshAllUsernameDisplays();
          $overlay.remove();
        });
      $buttonContainer.append($removeBtn);
    }
    
    // Cancel button
    var $cancelBtn = $('<button class="renameCancelBtn">Cancel</button>')
      .css({
        padding: '8px 16px',
        fontSize: '14px',
        backgroundColor: '#ccc',
        color: '#000',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      })
      .on('click', function() {
        $overlay.remove();
      });
    $buttonContainer.append($cancelBtn);
    
    // Save button
    var $saveBtn = $('<button class="renameSaveBtn">Save</button>')
      .css({
        padding: '8px 16px',
        fontSize: '14px',
        backgroundColor: '#4CAF50',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      })
      .on('click', function() {
        var newName = $input.val().trim();
        
        // Validation
        if (newName === '') {
          $errorMsg.text('Name cannot be empty').show();
          return;
        }
        
        if (newName.length > 30) {
          $errorMsg.text('Name must be 30 characters or less').show();
          return;
        }
        
        // Check if new name matches original (effectively removing rename)
        if (newName === originalUsername) {
          delete personalRenames[originalUsername];
        } else {
          personalRenames[originalUsername] = newName;
        }
        
        savePersonalRenames();
        refreshAllUsernameDisplays();
        $overlay.remove();
      });
    $buttonContainer.append($saveBtn);
    
    $dialog.append($buttonContainer);
    $overlay.append($dialog);
    $('body').append($overlay);
    
    // Focus input and select all text
    $input.focus().select();
    
    // Handle Enter key
    $input.on('keydown', function(e) {
      if (e.which === 13) { // Enter
        e.preventDefault();
        $saveBtn.click();
      } else if (e.which === 27) { // Escape
        e.preventDefault();
        $cancelBtn.click();
      }
    });
    
    // Close on overlay click
    $overlay.on('click', function(e) {
      if ($(e.target).hasClass('renamePromptOverlay')) {
        $overlay.remove();
      }
    });
  }
  
  // Refresh all UI elements that display usernames
  const refreshAllUsernameDisplays = () => {
    updatePlayerCircle();
    updateRoleAssignmentUI();
    // Note: Chat messages and log messages are historical and won't be updated
    // But new messages will use the renamed version
  }

  // Keyboard events (only for username input now)

  $window.keydown(event => {
    // Auto-focus the username input when a key is typed (only on login page)
    if (!(event.ctrlKey || event.metaKey || event.altKey) && !username) {
      $usernameInput.focus();
    }
    // When the client hits ENTER on their keyboard (only for username)
    if (event.which === 13 && !username) {
      setUsername();
    }
  });

  // Click events

  // Focus input when clicking anywhere on login page
  $loginPage.click(() => {
    $usernameInput.focus();
  });

  // Collapse button handler
  const toggleRoleAssignment = function() {
    roleAssignmentCollapsed = !roleAssignmentCollapsed;
    if (roleAssignmentCollapsed) {
      $roleAssignmentContent.slideUp(200);
      $collapseButton.text('▶');
      $collapseButton.attr('title', 'Expand role selection');
    } else {
      $roleAssignmentContent.slideDown(200);
      $collapseButton.text('▼');
      $collapseButton.attr('title', 'Collapse role selection');
    }
  };
  
  $collapseButton.on('click', function(e) {
    e.stopPropagation();
    toggleRoleAssignment();
  });
  
  // Make header clickable to toggle as well
  $('.roleAssignmentHeader').on('click', function(e) {
    // Only toggle if clicking on the header itself, not the button (button click is handled separately)
    if ($(e.target).closest('.collapseButton').length === 0) {
      toggleRoleAssignment();
    }
  });

  // Socket events

  // Whenever the server emits 'login', log the login message
  socket.on('login', (data) => {
    connected = true;
    // Hide any error messages
    $('.usernameError').fadeOut();
    // Now that login is confirmed, show the chat page
    $loginPage.fadeOut();
    $chatPage.css('display', 'flex');
    $loginPage.off('click');
    
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

  // Whenever the server emits 'username taken', show error and stay on login page
  socket.on('username taken', (data) => {
    // Show error message on login page
    var $errorMessage = $('.usernameError');
    if ($errorMessage.length === 0) {
      $errorMessage = $('<div class="usernameError"></div>');
      $('.form').append($errorMessage);
    }
    $errorMessage.text(data.message || 'Username is already taken. Please choose another.').fadeIn();
    
    // Clear the username input and refocus
    $usernameInput.val('').focus();
    username = null; // Reset username so user can try again
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

  // Track if we've cleared quest results for this role assignment round
  var questResultsClearedForNewGame = false;
  
  // Whenever the server emits 'role assigned', show the role to the player
  socket.on('role assigned', (data) => {
    // Remove previous role assignment messages for this player
    $('.messages .role-assignment-message').remove();
    
    // Clear quest results when roles are assigned (new game starting)
    // Only clear once per role assignment round
    if (!questResultsClearedForNewGame) {
      questResults = {};
      voteHistory = {};
      questMissionHistory = {};
      questResultsClearedForNewGame = true;
      voteTrackAtRequest = 1; // Reset vote track at request for new game
      // Re-initialize quest tokens to clear visual styling
      initializeQuestTokens();
    }
    
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

  // Handle role assignment error
  socket.on('role assignment error', (data) => {
    if (data.message) {
      log(data.message, {
        prepend: false,
        color: '#f44336'
      });
    }
  });

  // Whenever the server emits 'user list', update the connected users
  socket.on('user list', (data) => {
    var previousUsers = connectedUsers.slice(); // Copy previous user list
    connectedUsers = data.users || [];
    
    // Clear open dropdown tracking for users who disconnected
    // This prevents stale state from affecting the UI
    var currentUserSet = {};
    connectedUsers.forEach(function(user) {
      currentUserSet[user] = true;
    });
    
    // Remove tracking for users who are no longer connected
    Object.keys(openDropdowns).forEach(function(key) {
      var username = key.split('_')[0];
      if (!currentUserSet[username]) {
        delete openDropdowns[key];
      }
    });
    
    // Update vote track and quest index from server if provided
    if (data.voteTrack !== undefined) {
      currentVoteTrack = data.voteTrack;
    }
    if (data.questIndex !== undefined) {
      currentQuestIndex = data.questIndex;
    }
    
    // Reset quest results clearing flag when a new game starts (quest 1, vote 1)
    if (currentQuestIndex === 1 && currentVoteTrack === 1) {
      questResultsClearedForNewGame = false;
      voteTrackAtRequest = 1; // Reset vote track at request for new game
    }
    
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
      requestTeamSelection(data.questIndex, data.requiredTeamSize);
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
        // Don't hide buttons here - let request vote handle showing voting buttons
        // This prevents race condition where buttons are hidden then immediately shown
      }
    }
  });

  // Handle team size error
  socket.on('team size error', (data) => {
    if (data.message) {
      log(data.message, {
        prepend: false
      });
    }
  });

  // Handle vote request
  socket.on('request vote', (data) => {
    if (data.team && data.leader) {
      isVoting = true;
      pendingVote = null; // Reset any pending vote
      // Update vote track and quest index from server
      if (data.voteTrack !== undefined) {
        currentVoteTrack = data.voteTrack;
        voteTrackAtRequest = data.voteTrack; // Store the vote track when vote is requested
      }
      if (data.questIndex !== undefined) {
        currentQuestIndex = data.questIndex;
      }
      log('Mission ' + currentQuestIndex + ' Vote ' + currentVoteTrack, {
        prepend: false
      });
      log('Vote on team: ' + data.team.join(', '), {
        prepend: false
      });
      // Update UI to reflect new vote track
      initializeVoteTrack();
      updatePlayerCircle();
      // Show action buttons
      updateActionButtons();
    }
  });

  // Handle quest vote request
  socket.on('request quest vote', (data) => {
    if (data.questIndex && data.team) {
        // Check if current user is on the team
        if (data.team.indexOf(username) !== -1) {
          isQuestVoting = true;
          pendingQuestVote = null; // Reset any pending quest vote
          log('You were selected for quest ' + data.questIndex + '. Succeed or Fail?', {
            prepend: false
          });
          // Show action buttons
          updateActionButtons();
        }
    }
  });

  // Handle vote result
  socket.on('vote result', (data) => {
    if (data.approved !== undefined) {
      // Reset voting state
      isVoting = false;
      pendingVote = null;
      hideActionButtons();
      
      // Update vote track from server
      if (data.voteTrack !== undefined) {
        currentVoteTrack = data.voteTrack;
        initializeVoteTrack();
        updatePlayerCircle();
      }
      
      // Store vote history for current quest
      // Use voteTrackAtRequest (the vote track when vote was requested) instead of the current voteTrack
      // because the server increments voteTrack after a rejected vote
      if (!voteHistory[currentQuestIndex]) {
        voteHistory[currentQuestIndex] = [];
      }
      voteHistory[currentQuestIndex].push({
        voteTrack: voteTrackAtRequest,
        team: data.team || [],
        leader: data.leader || '',
        approveVoters: data.approveVoters || [],
        rejectVoters: data.rejectVoters || [],
        approved: data.approved,
        approveCount: data.approveCount || 0,
        rejectCount: data.rejectCount || 0
      });
      
      // Refresh vote track to update tooltips with new vote data
      initializeVoteTrack();
      
      // Display individual votes
      var approveText = 'Approve: ' + (data.approveVoters && data.approveVoters.length > 0 ? data.approveVoters.join(', ') : 'None');
      var rejectText = 'Reject: ' + (data.rejectVoters && data.rejectVoters.length > 0 ? data.rejectVoters.join(', ') : 'None');
      
      log(approveText, {
        prepend: false,
        color: '#4CAF50'
      });
      log(rejectText, {
        prepend: false,
        color: '#f44336'
      });
      
      var resultText = 'Vote result: ';
      if (data.approved) {
        resultText += 'APPROVED (' + data.approveCount + ' approve, ' + data.rejectCount + ' reject). Mission ' + currentQuestIndex + ' begins!';
        log(resultText, {
          prepend: false,
          color: '#4CAF50'
        });
        
        // Quest voting will be initiated by server, don't proceed here
        // The quest result handler will handle proceeding to next quest
      } else {
        resultText += 'REJECTED (' + data.approveCount + ' approve, ' + data.rejectCount + ' reject).';
        log(resultText, {
          prepend: false,
          color: '#f44336'
        });
        
        // Rotate leader
        rotateLeader();
        
        // If vote track hasn't reached 5, request new team selection
        if (currentVoteTrack > 5) {
          log('Vote track reached 5. Game over - spies win!', {
            prepend: false
          });
        } else {
          setTimeout(function() {
            socket.emit('start team selection', {
              questIndex: currentQuestIndex
            });
          }, 1000);
        }
      }
      
      // Update quest tokens to refresh tooltips
      initializeQuestTokens();
    }
  });

  // Handle quest result
  socket.on('quest result', (data) => {
    if (data.questIndex && data.successCount !== undefined && data.failCount !== undefined) {
      // Reset quest voting state
      isQuestVoting = false;
      pendingQuestVote = null;
      hideActionButtons();
      
      // Update vote track from server (should be reset to 1)
      if (data.voteTrack !== undefined) {
        currentVoteTrack = data.voteTrack;
        initializeVoteTrack();
      }
      
      // Use server-provided quest success status if available, otherwise calculate
      var questSucceeded = data.questSucceeded !== undefined ? data.questSucceeded : (data.failCount === 0);
      
      // Store quest result
      questResults[data.questIndex] = questSucceeded ? 'success' : 'fail';
      
      // Store quest mission history
      questMissionHistory[data.questIndex] = {
        team: data.team || [],
        successCount: data.successCount,
        failCount: data.failCount,
        questSucceeded: questSucceeded
      };
      
      // Publish quest results to everyone
      log('Quest ' + data.questIndex + ' results: ' + data.successCount + ' Success, ' + data.failCount + ' Fail', {
        prepend: false,
        color: questSucceeded ? '#4CAF50' : '#f44336'
      });
      
      // Show successful quest count if provided
      if (data.successfulQuests !== undefined) {
        log('Good team has won ' + data.successfulQuests + ' quest(s)', {
          prepend: false,
          color: '#4CAF50'
        });
      }
      
      // Sync quest index with server, then increment
      currentQuestIndex = data.questIndex;
      // Increment quest token (this will also increment currentQuestIndex)
      incrementQuestToken();
      
      // Re-initialize quest tokens to show success/fail styling
      initializeQuestTokens();
      
      // Update player circle to reflect new vote track
      updatePlayerCircle();
      
      // If good team has won 3 quests, assassin phase will be triggered by server
      // Don't proceed to next quest in that case
      if (data.successfulQuests !== undefined && data.successfulQuests >= 3) {
        // Assassin phase will be triggered, don't proceed to next quest
        return;
      }
      
      // Rotate leader (server handles this, wait for user list update)
      // After user list updates, request team selection for next quest
      setTimeout(function() {
        if (currentQuestIndex <= 5) {
          socket.emit('start team selection', {
            questIndex: currentQuestIndex
          });
        }
      }, 1500); // Wait for user list to update
    }
  });

  // Handle assassin phase started
  socket.on('assassin phase started', (data) => {
    if (data.assassin) {
      log('Good team has won 3 quests! Assassin phase begins. ' + data.assassin + ' is the Assassin.', {
        prepend: false,
        color: '#f44336'
      });
    }
  });

  // Handle request for assassin guess
  socket.on('request assassin guess', (data) => {
    isAssassinPhase = true;
    pendingAssassinGuess = null;
    goodTeamPlayers = data.goodTeamPlayers || [];
    
    // Show minions of Mordred information again
    if (data.minionsOfMordred && data.minionsOfMordred.length > 0) {
      log('Minions of Mordred - ' + data.minionsOfMordred.join(', '), {
        prepend: false,
        color: '#f44336'
      });
    }
    
    // Tell the player they are the assassin and who they need to kill
    var targetMessage = 'You are the Assassin! You need to kill ' + (data.targetDescription || 'the target') + '.';
    log(targetMessage, {
      prepend: false,
      color: '#f44336'
    });
    
    log('Click on a good team player name in the circle above to make your guess.', {
      prepend: false,
      color: '#f44336'
    });
    
    if (goodTeamPlayers.length > 0) {
      log('Good team players: ' + goodTeamPlayers.join(', '), {
        prepend: false
      });
    }
    
    // Update player circle to make names clickable
    updatePlayerCircle();
    // Show message to select a player
    updateActionButtons();
  });
  
  // Handle partial assassin guess (for Tristan/Isolde when one is guessed correctly)
  socket.on('assassin guess partial', (data) => {
    if (data.message) {
      log(data.message, {
        prepend: false,
        color: '#f44336'
      });
    }
    
    // Reset pending guess to allow another guess
    pendingAssassinGuess = null;
    
    // Update player circle to allow another selection
    updatePlayerCircle();
    updateActionButtons(); // Show message again
  });
  
  // Handle assassin guess error
  socket.on('assassin guess error', (data) => {
    if (data.message) {
      log(data.message, {
        prepend: false,
        color: '#f44336'
      });
    }
    // Reset guess to allow trying again
    pendingAssassinGuess = null;
    updatePlayerCircle();
    updateActionButtons(); // Show message again
  });

  // Handle waiting status updates
  socket.on('waiting status', (data) => {
    updateWaitingStatus(data);
  });

  // Handle game over
  socket.on('game over', (data) => {
    // Reset all game states
    isVoting = false;
    pendingVote = null;
    isQuestVoting = false;
    pendingQuestVote = null;
    isSelectingTeam = false;
    selectedTeam = [];
    isAssassinPhase = false;
    pendingAssassinGuess = null;
    goodTeamPlayers = [];
    hideActionButtons();
    
    // Clear quest results and reset flag
    questResults = {};
    voteHistory = {};
    questMissionHistory = {};
    questResultsClearedForNewGame = false;
    voteTrackAtRequest = 1; // Reset vote track at request
    
    // Re-initialize quest tokens to clear visual styling
    initializeQuestTokens();
    
    // Clear waiting status
    $('.waiting-status-message').remove();
    
    var winnerColor = data.winner === 'good' ? '#4CAF50' : '#f44336';
    var winnerText = data.winner === 'good' ? 'GOOD TEAM WINS!' : 'EVIL TEAM WINS!';
    
    log('=== GAME OVER ===', {
      prepend: false,
      color: winnerColor
    });
    log(winnerText, {
      prepend: false,
      color: winnerColor
    });
    
    if (data.reason) {
      log(data.reason, {
        prepend: false,
        color: winnerColor
      });
    }
    
    if (data.guessedPlayer && data.actualMerlin) {
      log('Assassin guessed: ' + data.guessedPlayer, {
        prepend: false
      });
      log('Actual Merlin: ' + data.actualMerlin, {
        prepend: false
      });
    }
  });

});
