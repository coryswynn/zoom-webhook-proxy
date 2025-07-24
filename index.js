require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const axios = require('axios')

const app = express()
const port = process.env.PORT || 4000

// Required environment variables
const ZOOM_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN
const GOOGLE_SCRIPT_WEBHOOK_URL = process.env.GOOGLE_SCRIPT_WEBHOOK_URL
const GOOGLE_SCRIPT_TOKEN = process.env.GOOGLE_SCRIPT_TOKEN

app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.status(200).send(
    `Zoom Webhook sample running. Set this URL (with /webhook) as your app's Event notification endpoint.`
  )
})

app.post('/webhook', async (req, res) => {
  let response

  console.log('Headers:', req.headers)
  console.log('Body:', req.body)

  const timestamp = req.headers['x-zm-request-timestamp']
  const zmSignature = req.headers['x-zm-signature']

  // Construct the message string exactly as Zoom requires
  const message = `v0:${timestamp}:${JSON.stringify(req.body)}`

  // Hash the message string with your Webhook Secret Token
  const hashForVerify = crypto
    .createHmac('sha256', ZOOM_SECRET)
    .update(message)
    .digest('hex')

  const signature = `v0=${hashForVerify}`

  // Validate the request came from Zoom
  if (zmSignature === signature) {
    // Handle endpoint validation
    if (req.body.event === 'endpoint.url_validation') {
      const plainToken = req.body.payload.plainToken
      const encryptedToken = crypto
        .createHmac('sha256', ZOOM_SECRET)
        .update(plainToken)
        .digest('hex')

      response = {
        plainToken,
        encryptedToken
      }

      console.log('✅ Responding to endpoint validation:', response)
      return res.status(200).json(response)
    } else {
      // For all other events, respond OK to Zoom first
      response = { message: 'Authorized request to Zoom Webhook sample.' }
      res.status(200).json(response)
      console.log('✅ Valid event received:', req.body.event)

      // --- Forward event to Google Apps Script for Google Sheet logging ---
      try {
        // POST to Google Apps Script with token field
        await axios.post(
          GOOGLE_SCRIPT_WEBHOOK_URL,
          {
            ...req.body,
            token: GOOGLE_SCRIPT_TOKEN // Apps Script expects this!
          },
          {
            headers: { 'Content-Type': 'application/json' }
          }
        )
        console.log('✅ Event sent to Google Apps Script for logging.')
      } catch (err) {
        console.error('❌ Failed to send event to Google Apps Script:', err.message)
      }
    }
  } else {
    // Signature did not match
    response = { message: 'Unauthorized request to Zoom Webhook sample.' }
    console.log('❌ Invalid signature. Rejecting request.')
    res.status(401).json(response)
  }
})

app.listen(port, () => console.log(`🚀 Zoom Webhook sample listening on port ${port}!`))
