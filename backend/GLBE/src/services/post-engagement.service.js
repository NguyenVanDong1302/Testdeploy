const Comment = require("../models/Comment");
const Post = require("../models/Post");
const { getIO } = require("../realtime/socket");
const { AppError } = require("../utils/errors");
const {
  createOrUpdateGroupedNotification,
  removeActorFromLikeNotification,
} = require("./notification.service");

async function togglePostLike({ postId, user }) {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

  const userId = user.sub;
  const idx = (post.likes || []).indexOf(userId);

  let liked;
  if (idx >= 0) {
    post.likes.splice(idx, 1);
    liked = false;
  } else {
    post.likes.push(userId);
    liked = true;
  }

  await post.save();

  const io = getIO();
  io.to(`post:${post._id}`).emit("post:like", {
    postId: String(post._id),
    likesCount: post.likes.length,
    likedBy: user.username,
    liked,
  });

  if (post.authorId !== userId) {
    if (liked) {
      await createOrUpdateGroupedNotification({
        recipientId: post.authorId,
        type: "like",
        targetId: String(post._id),
        actorId: userId,
        actorUsername: user.username,
      });
    } else {
      await removeActorFromLikeNotification({
        recipientId: post.authorId,
        targetId: String(post._id),
        actorId: userId,
      });
    }
  }

  return {
    postId: post._id,
    liked,
    likesCount: post.likes.length,
    displayLikesCount: post.hideLikeCount ? null : post.likes.length,
  };
}

async function removePostLike({ postId, user }) {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");

  const userId = user.sub;
  post.likes = (post.likes || []).filter((item) => item !== userId);
  await post.save();

  const io = getIO();
  io.to(`post:${post._id}`).emit("post:like", {
    postId: String(post._id),
    likesCount: post.likes.length,
    likedBy: user.username,
    liked: false,
  });

  if (post.authorId !== userId) {
    await removeActorFromLikeNotification({
      recipientId: post.authorId,
      targetId: String(post._id),
      actorId: userId,
    });
  }

  return {
    postId: post._id,
    liked: false,
    likesCount: post.likes.length,
    displayLikesCount: post.hideLikeCount ? null : post.likes.length,
  };
}

async function addPostComment({ postId, user, content }) {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("Post not found", 404, "NOT_FOUND");
  if (!post.allowComments) {
    throw new AppError("Comments are disabled for this post", 400, "COMMENTS_DISABLED");
  }

  const comment = await Comment.create({
    postId: post._id,
    authorId: user.sub,
    authorUsername: user.username,
    content,
  });

  const io = getIO();
  io.to(`post:${post._id}`).emit("post:comment", {
    postId: String(post._id),
    comment: {
      _id: String(comment._id),
      authorId: comment.authorId,
      authorUsername: comment.authorUsername,
      content: comment.content,
      createdAt: comment.createdAt,
    },
  });

  if (post.authorId !== user.sub) {
    await createOrUpdateGroupedNotification({
      recipientId: post.authorId,
      type: "comment",
      targetId: String(post._id),
      actorId: user.sub,
      actorUsername: user.username,
      contentPreview: comment.content.slice(0, 160),
    });
  }

  return comment;
}

module.exports = {
  togglePostLike,
  removePostLike,
  addPostComment,
};
