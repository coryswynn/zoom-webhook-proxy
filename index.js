require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const port = process.env.PORT || 4000

app.use(bodyParser.json())

/* ---------------- Supabase (optional) ---------------- */
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

/* ---------------- helpers ---------------- */
const within = (a, b, ms) => Math.abs(new Date(a) - new Date(b)) <= ms
const minutesBetween = (a,b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null
const participantKey = (p = {}) =>
  p.participant_uuid || p.email || p.participant_user_id || p.user_id || p.user_name || 'unknown'
const roomFromEvent = (raw = {}) => {
  const br = raw?.payload?.object?.breakout_room_uuid
  return br ? `breakout:${br}` : 'main'
}
const asIso = (s) => s ? new Date(s).toISOString() : null

/** pull a participant row to compute current room from last hop */
async function getCurrentRoom(meeting_uuid, pkey) {
  if (!supabase) return 'main'
  const { data, error } = await supabase
    .from('session_participants')
    .select('hops')
    .eq('meeting_uuid', meeting_uuid)
    .eq('participant_key', pkey)
    .maybeSingle()

  if (error || !data) return 'main'
  const hops = Array.isArray(data.hops) ? data.hops : []
  if (!hops.length) return 'main'
  return hops[hops.length - 1].to || 'main'
}

/** append a hop in DB (from -> to at time) */
async function appendHop(meeting_uuid, pkey, hop) {
  if (!supabase) return
  // get existing hops
  const { data } = await supabase
    .from('session_participants')
    .select('hops')
    .eq('meeting_uuid', meeting_uuid)
    .eq('participant_key', pkey)
    .maybeSingle()

  const oldHops = Array.isArray(data?.hops) ? data.hops : []
  const newHops = oldHops.concat([hop])

  await supabase
    .from('session_participants')
    .update({ hops: newHops })
    .eq('meeting_uuid', meeting_uuid)
    .eq('participant_key', pkey)
}

/** idempotent upsert of session row */
async function upsertSession({ meeting_uuid, meeting_id, topic, tz, started_at, ended_at }) {
  if (!supabase || !meeting_uuid) return
  const row = { meeting_uuid, meeting_id, topic, tz, started_at, ended_at }
  Object.keys(row).forEach(k => row[k] == null && delete row[k])
  await supabase.from('supervision_sessions').upsert(row, { onConflict: 'meeting_uuid' })
}

/** idempotent upsert of participant row (keyed by meeting_uuid + participant_key) */
async function upsertParticipant({
  meeting_uuid, pkey, participant_uuid, name, email, role, present_from, present_to
}) {
  if (!supabase || !meeting_uuid || !pkey) return

  // Always try to upsert — safe, no pre-select required
  const row = {
    meeting_uuid,
    session_id: meeting_uuid, // 👈 ensure not-null (assuming session_id maps to meeting_uuid)
    participant_key: pkey,
    participant_uuid,
    name,
    email,
    role,
    present_from,
    present_to,
    total_minutes: minutesBetween(present_from, present_to)
  }
  Object.keys(row).forEach(k => row[k] == null && delete row[k])

  const { error } = await supabase
    .from('session_participants')
    .upsert(row, { onConflict: 'meeting_uuid,participant_key' })

  if (error) {
    console.error('❌ upsert participant error:', error.message)
  } else {
    console.log('✅ participant upsert ok:', meeting_uuid, pkey)
  }
}

/* ---------------- routes ---------------- */

app.get('/', (req, res) => {
  res.status(200)
  res.send(`Zoom Webhook sample successfully running. Set this URL with the /webhook path as your apps Event notification endpoint URL. https://github.com/zoom/webhook-sample`)
})

app.post('/webhook', async (req, res) => {
  let response

  console.log(req.headers)
  console.log(req.body)

  // construct the message string
  const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`
  const hashForVerify = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN).update(message).digest('hex')
  const signature = `v0=${hashForVerify}`

  if (req.headers['x-zm-signature'] === signature) {
    if (req.body.event === 'endpoint.url_validation') {
      const hashForValidate = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN).update(req.body.payload.plainToken).digest('hex')

      response = { message: { plainToken: req.body.payload.plainToken, encryptedToken: hashForValidate }, status: 200 }
      console.log(response.message)
      res.status(response.status).json(response.message)
    } else {
      response = { message: 'Authorized request to Zoom Webhook sample.', status: 200 }
      console.log(response.message)
      res.status(response.status).json(response)

      /* ---------------- your existing Google Sheet forwarder ---------------- */
      try {
        await axios.post(
          process.env.GOOGLE_SCRIPT_WEBHOOK_URL,
          { ...req.body, token: process.env.GOOGLE_SCRIPT_TOKEN },
          { headers: { 'Content-Type': 'application/json' } }
        )
        console.log('✅ Event sent to Google Sheet')
      } catch (err) {
        console.error('❌ Failed to send event to Google Sheet:', err.message)
      }
      /* ---------------- end Google Sheet forwarder ---------------- */

      /* ---------------- NEW: Supabase persistence (non-blocking) ---------------- */
      ;(async () => {
        if (!supabase) return

        try {
          const raw = req.body
          const obj = raw?.payload?.object || {}
          const event = raw?.event
          const meeting_uuid = obj?.uuid
          const meeting_id = obj?.id ? String(obj.id) : undefined
          const topic = obj?.topic
          const tz = obj?.timezone

          // 1) Ensure/Update session row
          if (event === 'meeting.started') {
            await upsertSession({ meeting_uuid, meeting_id, topic, tz, started_at: asIso(obj.start_time) })
          } else if (event === 'meeting.ended') {
            await upsertSession({ meeting_uuid, meeting_id, topic, tz, ended_at: asIso(obj.end_time) })
          } else {
            await upsertSession({ meeting_uuid, meeting_id, topic, tz })
          }

          // 2) Participant-level handling
          const p = obj.participant || {}
          const pkey = participantKey(p)
          if (!pkey || !meeting_uuid) return

          // Normalize times
          const join_at = asIso(p.join_time)
          const leave_at = asIso(p.leave_time)
          const role_changed_at = asIso(obj?.participant?.date_time)

          // Basic presence upserts
          if (event === 'meeting.participant_joined') {
            await upsertParticipant({
              meeting_uuid,
              pkey,
              participant_uuid: p.participant_uuid,
              name: p.user_name,
              email: p.email,
              role: 'attendee',
              present_from: join_at
            })

            // Room hop: we assume joins are into MAIN (Zoom usually does this)
            const prevRoom = await getCurrentRoom(meeting_uuid, pkey)
            const nowRoom = 'main'
            if (prevRoom !== nowRoom) {
              await appendHop(meeting_uuid, pkey, { at: join_at || new Date().toISOString(), from: prevRoom, to: nowRoom })
            }
          }

          if (event === 'meeting.participant_role_changed') {
            await upsertParticipant({
              meeting_uuid,
              pkey,
              participant_uuid: p.participant_uuid,
              name: p.user_name,
              email: p.email,
              role: (obj.participant?.new_role === 'host') ? 'host' : 'attendee'
            })
          }

          if (event === 'meeting.participant_left') {
            // Set present_to. If reason indicates "join breakout", record hop if you later see joined_breakout (rare); here we just close interval.
            await upsertParticipant({
              meeting_uuid,
              pkey,
              participant_uuid: p.participant_uuid,
              name: p.user_name,
              email: p.email,
              present_to: leave_at
            })

            // If leave_reason mentions "join breakout room", we tentatively record a hop main->breakout:unknown for visibility
            const reason = (p.leave_reason || '').toLowerCase()
            if (reason.includes('join breakout')) {
              const prevRoom = await getCurrentRoom(meeting_uuid, pkey)
              const toRoom = 'breakout:unknown'
              if (prevRoom !== toRoom) {
                await appendHop(meeting_uuid, pkey, { at: leave_at || new Date().toISOString(), from: prevRoom, to: toRoom })
              }
            }
          }

          // Breakout specific: leaving a breakout → usually going to main
          if (event === 'meeting.participant_left_breakout_room') {
            // keep presence open; just record the hop breakout -> main
            const fromRoom = roomFromEvent(raw) // "breakout:<uuid>"
            const toRoom = 'main'
            const at = leave_at || new Date().toISOString()

            // make sure the row exists (does not change present_from/to)
            await upsertParticipant({
              meeting_uuid,
              pkey,
              participant_uuid: p.participant_uuid,
              name: p.user_name,
              email: p.email
            })

            const prevRoom = await getCurrentRoom(meeting_uuid, pkey)
            // If we already think they were in this breakout, just hop to main; else still add hop from prev->main
            const hopFrom = prevRoom || fromRoom
            if (hopFrom !== toRoom) {
              await appendHop(meeting_uuid, pkey, { at, from: hopFrom, to: toRoom })
            }
          }

          console.log('✅ Supabase upsert ok:', event, meeting_uuid, pkey)
        } catch (e) {
          console.error('❌ Supabase write failed:', e.message)
        }
      })()
      /* ---------------- end Supabase persistence ---------------- */
    }
  } else {
    response = { message: 'Unauthorized request to Zoom Webhook sample.', status: 401 }
    res.status(response.status)
    res.json(response)
  }
})

app.listen(port, () => console.log(`Zoom Webhook sample listening on port ${port}!`))
