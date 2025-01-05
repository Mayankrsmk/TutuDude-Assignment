const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Send friend request
router.post('/request/:userId', authMiddleware, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if request already exists
    const existingRequest = targetUser.friendRequests.find(
      request => request.from.toString() === req.userId
    );
    if (existingRequest) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }

    // Add friend request
    targetUser.friendRequests.push({
      from: req.userId,
      status: 'pending'
    });
    await targetUser.save();

    res.json({ message: 'Friend request sent successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error sending friend request' });
  }
});

// Accept/Reject friend request
router.put('/request/:requestId', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body; // 'accepted' or 'rejected'
    const user = await User.findById(req.userId);
    
    const request = user.friendRequests.id(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (status === 'accepted') {
      // Add to friends list for both users
      user.friends.push(request.from);
      const otherUser = await User.findById(request.from);
      otherUser.friends.push(user._id);
      await otherUser.save();
    }

    // Update request status
    request.status = status;
    await user.save();

    res.json({ message: `Friend request ${status}` });
  } catch (error) {
    res.status(500).json({ message: 'Error processing friend request' });
  }
});

// Get friend recommendations
router.get('/recommendations', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('friends');
    
    // Get friends of friends
    const friendIds = user.friends.map(friend => friend._id);
    const recommendations = await User.aggregate([
      // Match users who are not the current user and not already friends
      {
        $match: {
          _id: { 
            $nin: [...friendIds, user._id] 
          }
        }
      },
      // Look up mutual friends
      {
        $lookup: {
          from: 'users',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$_id', friendIds] },
                    { $in: ['$$userId', '$friends'] }
                  ]
                }
              }
            }
          ],
          as: 'mutualFriends'
        }
      },
      // Add mutual friends count
      {
        $addFields: {
          mutualFriendsCount: { $size: '$mutualFriends' }
        }
      },
      // Sort by number of mutual friends
      {
        $sort: { mutualFriendsCount: -1 }
      },
      // Limit to 10 recommendations
      {
        $limit: 10
      },
      // Project only necessary fields
      {
        $project: {
          _id: 1,
          username: 1,
          email: 1,
          mutualFriendsCount: 1
        }
      }
    ]);

    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ message: 'Error getting recommendations' });
  }
});

// Unfriend user
router.delete('/unfriend/:userId', authMiddleware, async (req, res) => {
  try {
    const [user, friendUser] = await Promise.all([
      User.findById(req.userId),
      User.findById(req.params.userId)
    ]);

    if (!user || !friendUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove from both users' friend lists
    user.friends = user.friends.filter(
      friend => friend.toString() !== req.params.userId
    );
    friendUser.friends = friendUser.friends.filter(
      friend => friend.toString() !== req.userId
    );

    await Promise.all([user.save(), friendUser.save()]);

    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error unfriending user' });
  }
});

module.exports = router;