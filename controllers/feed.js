const { validationResult } = require('express-validator')
const path = require('path')
const fs = require('fs')

const Post = require('../models/post')
const User = require('../models/user')

const socket = require('../socket')

exports.getPosts = async (req, res, next) => {
    const currentPage = req.query.page || 1
    const perPage = 10

    try {
        const totalItems = await Post.find().countDocuments()
        const posts = await Post.find()
            .populate('creator')
            .skip((currentPage - 1) * perPage)
            .limit(perPage)
            .sort({ createdAt: -1 })
        res.status(200).json({
            posts: posts,
            totalItems: totalItems,
        })
    } catch (err) {
        if (!err.statusCode) {
            err.statusCode = 500
        }
        next(err)
    }
}

exports.createPost = (req, res, next) => {
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
        const error = new Error('Validation failed, entered data is incorrect.')
        error.statusCode = 422
        throw error
    }

    if (!req.file) {
        const error = new Error('No image provided.')
        error.statusCode = 422
        throw error
    }

    const title = req.body.title
    const content = req.body.content
    const imageUrl = req.file.path.replace('\\', '/')

    // Create post in db
    let creator
    const post = new Post({
        title: title,
        content: content,
        imageUrl: imageUrl,
        creator: req.userId,
    })

    post.save()
        .then(res => {
            return User.findById(req.userId)
        })
        .then(user => {
            creator = user
            user.posts.push(post)
            return user.save()
        })
        .then(result => {
            socket.getIO().emit('posts', {
                action: 'create',
                post: post,
            })
            res.status(201).json({
                message: 'Post created successfully!',
                post: post,
                creator: { _id: creator._id, name: creator.name },
            })
        })
        .catch(err => {
            next(err)
        })
}

exports.getSinglePost = (req, res, next) => {
    const postId = req.params.postId
    Post.findById(postId)
        .then(post => {
            if (!post) {
                const error = new Error('Could not find post.')
                error.statusCode = 404
                throw error
            }

            res.status(200).json({ message: 'Post fetched.', post: post })
        })
        .catch(err => {
            next(err)
        })
}

exports.updatePost = (req, res, next) => {
    const postId = req.params.postId

    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        const error = new Error('Validation failed, entered data is incorrect.')
        error.statusCode = 422
        throw error
    }

    const title = req.body.title
    const content = req.body.content
    let imageUrl = req.body.image

    if (req.file) {
        imageUrl = req.file.path.replace('\\', '/')
    }

    if (!imageUrl) {
        const error = new Error('No file picked.')
        error.statusCode = 422
        throw error
    }

    Post.findById(postId)
        .then(post => {
            if (!post) {
                const error = new Error('Could not find post.')
                error.statusCode = 404
                throw error
            }

            if (post.creator.toString() !== req.userId) {
                const error = new Error('Not authorized!')
                error.statusCode = 403
                throw error
            }

            if (imageUrl !== post.imageUrl) {
                clearImage(post.imageUrl)
            }
            post.title = title
            post.imageUrl = imageUrl
            post.content = content
            return post.save()
        })
        .then(result => {
            socket.getIO().emit('posts', { action: 'update', post: result })
            res.status(200).json({ message: 'Post updated!', post: result })
        })
        .catch(err => {
            next(err)
        })
}

exports.deletePost = (req, res, next) => {
    const postId = req.params.postId
    Post.findById(postId)
        .then(post => {
            // Check logged in user
            if (!post) {
                const error = new Error('Could not find post.')
                error.statusCode = 404
                throw error
            }
            // Check logged in user
            if (post.creator.toString() !== req.userId) {
                const error = new Error('Not authorized!')
                error.statusCode = 403
                throw error
            }

            clearImage(post.imageUrl)
            return Post.findByIdAndRemove(postId)
        })
        .then(result => {
            return User.findById(req.userId)
        })
        .then(user => {
            user.posts.pull(postId)
            return user.save()
        })
        .then(result => {
            socket.getIO().emit('posts', { action: 'delete', post: postId })
            res.status(200).json({ message: 'Deleted post.' })
        })
        .catch(err => next(err))
}

const clearImage = filePath => {
    filePath = path.join(__dirname, '..', filePath)
    fs.unlink(filePath, err => console.log(err))
}
