import { computed, reactive, ref } from 'vue'
import type {
  Booking, Court, FeeItem, Incident, IncidentAction, IncidentStatus,
  IncidentType, Member, MergeRequest, RoleId, Scope, TimelineEvent
} from './types'
import { BOOKINGS, COURTS, INCIDENTS, MERGE_REQUESTS, NOW_HM, ROLES, TODAY } from './data/mock'
import {
  checkedInCount, feeSummary, hm, hmLabel, lightQuote,
  underfillView, boundaryConfirmed,
  UNDERFILL_KEEP_MINUTES, FULL_KEEP_FEE
} from './lib/engine'

// ---------- 模拟时钟 ----------
const nowStr = ref(NOW_HM)
export const nowMin = computed(() => hm(nowStr.value))
let timer: ReturnType<typeof setInterval> | null = null
const autoRun = ref(false)

export function tick(min = 1) {
  let v = nowMin.value + min
  if (v >= 24 * 60) v = 23 * 60 + 59
  const h = Math.floor(v / 60)
  const m = v % 60
  nowStr.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  syncTimeEffects()
}
export function resetClock() {
  nowStr.value = NOW_HM
}
export function toggleAuto() {
  autoRun.value = !autoRun.value
  if (autoRun.value) {
    timer = setInterval(() => tick(1), 10_000) // 演示：每 10 秒推进 1 分钟
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}
export { nowStr, autoRun }

// ---------- 全局状态 ----------
interface State {
  role: RoleId
  courts: Court[]
  bookings: Booking[]
  incidents: Incident[]
  mergeRequests: MergeRequest[]
  /** 站内消息（模拟短信/通知） */
  notices: { id: number; to: RoleId | 'all'; text: string; at: string }[]
}

const state = reactive<State>({
  role: 'captain',
  courts: structuredClone(COURTS),
  bookings: structuredClone(BOOKINGS),
  incidents: structuredClone(INCIDENTS),
  mergeRequests: structuredClone(MERGE_REQUESTS),
  notices: []
})

let noticeSeq = 1
export function notify(to: RoleId | 'all', text: string) {
  state.notices.unshift({ id: noticeSeq++, to, text, at: nowStr.value })
}

export function useState() {
  return state
}
export const roles = ROLES
export function setRole(r: RoleId) {
  state.role = r
}

const idCounters: Record<string, number> = { B: 11, 'MR-': 4, I: 7 }
function nextId(prefix: string, pad = 3) {
  const n = (idCounters[prefix] = (idCounters[prefix] ?? 0) + 1)
  return `${prefix}${String(n).padStart(pad, '0')}`
}
const seq = { member: 100 }

function tl(b: Booking, text: string, tone: TimelineEvent['tone'] = 'default') {
  b.timeline.push({ at: nowStr.value, text, tone })
}

// ---------- 预约 ----------
export interface BookingForm {
  courtId: string
  halves: string[]
  scope: Scope
  start: string
  end: string
  headcount: number
  acceptMerge: boolean
  needLight: boolean
  teamName: string
  captainName: string
  captainPhone: string
}

export function createBooking(form: BookingForm): Booking {
  const id = nextId('B')
  const member: Member = {
    id: `m-new-${seq.member}`,
    name: form.captainName || '我',
    phone: form.captainPhone || '未填写',
    isCaptain: true,
    checkedIn: false
  }
  const b: Booking = {
    id,
    code: String(100000 + Math.floor(Math.random() * 899999)),
    courtId: form.courtId,
    halves: form.halves,
    scope: form.scope,
    date: TODAY,
    start: form.start,
    end: form.end,
    headcount: form.headcount,
    acceptMerge: form.acceptMerge,
    teamName: form.teamName || '我的队伍',
    captainId: 'u-me',
    captainName: form.captainName || '我',
    captainPhone: form.captainPhone || '未填写',
    members: [member],
    status: 'booked',
    payStatus: 'unpaid',
    checkInCode: '',
    lighting: { enabled: false, minutes: 0, fee: 0, deposit: 0 },
    fees: [],
    credit: 100,
    timeline: []
  }
  b.checkInCode = b.code
  tl(b, `预约成功：${form.scope === 'full' ? '全场' : '半场'} ${form.halves.join('/')} ${form.start}–${form.end}，${form.headcount} 人${form.acceptMerge ? '，接受拼场（照明 8 折）' : '，不接受拼场'}`, 'success')
  if (form.headcount < (form.scope === 'full' ? 8 : 4)) {
    tl(b, '人数低于建议下限，系统建议开放拼场以提高公共场地利用率（R-BOOK-1）', 'warning')
  }
  if (form.needLight) {
    tl(b, '已预约夜间照明，开灯前需支付照明押金（半场 50 元 / 全场 100 元，R-LIGHT-2）', 'info')
  }
  state.bookings.push(b)
  notify(state.role, `预约成功，签到码 ${b.code}，请在开场后 15 分钟内签到`)
  return b
}

// ---------- 签到 / 队员 ----------
export function addMember(bookingId: string, name: string, phone: string, minor = false) {
  const b = state.bookings.find(x => x.id === bookingId)
  if (!b || !name.trim()) return
  b.members.push({
    id: `m-inv-${++seq.member}`,
    name: name.trim(),
    phone: phone.trim() || '未填写',
    isCaptain: false,
    checkedIn: false,
    minor
  })
  b.headcount = b.members.length
  tl(b, `队长向 ${name} 发送签到邀请（签到码 ${b.checkInCode}）`, 'info')
}

export function toggleCheckIn(bookingId: string, memberId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const m = b.members.find(x => x.id === memberId)!
  m.checkedIn = !m.checkedIn
  m.checkInAt = m.checkedIn ? nowStr.value : undefined
  if (m.checkedIn) {
    if (b.status === 'booked') {
      b.status = hm(nowStr.value) > hm(b.start) + 15 ? 'late' : 'ongoing'
      b.actualStart = b.actualStart ?? nowStr.value
    }
    tl(b, `${m.name} 到场签到（${checkedInCount(b)}/${b.members.length}）`, 'success')
  }
}

/** 散客凭签到码自助签到 */
export function checkInByCode(code: string, name: string): boolean {
  const b = state.bookings.find(x => x.checkInCode === code)
  if (!b) return false
  const m = b.members.find(x => x.name.includes(name) || name.includes(x.name)) ??
    (name ? { id: `m-inv-${++seq.member}`, name, phone: '现场签到', isCaptain: false, checkedIn: false } as Member : undefined)
  if (m && !b.members.includes(m)) b.members.push(m)
  if (!m) return false
  m.checkedIn = true
  m.checkInAt = nowStr.value
  if (b.status === 'booked') {
    b.status = hm(nowStr.value) > hm(b.start) + 15 ? 'late' : 'ongoing'
    b.actualStart = b.actualStart ?? nowStr.value
  }
  tl(b, `${m.name} 凭签到码到场签到（${checkedInCount(b)}/${b.members.length}）`, 'success')
  return true
}

// ---------- 拼场 ----------
export function applyMerge(bookingId: string, walkerName: string, walkerPhone: string, people: number, message: string, minor = false) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const req: MergeRequest = {
    id: nextId('MR-'),
    bookingId,
    walkerName,
    walkerPhone,
    people,
    minor,
    message,
    status: 'pending',
    time: nowStr.value
  }
  state.mergeRequests.unshift(req)
  tl(b, `散客 ${walkerName} 等 ${people} 人申请拼场，队长须在 10 分钟内处理（R-BOOK-2）`, 'warning')
  notify('captain', `新拼场申请：${walkerName} 等 ${people} 人想加入 ${b.teamName}`)
}

export function respondMerge(reqId: string, accept: boolean, reason = '') {
  const req = state.mergeRequests.find(x => x.id === reqId)!
  const b = state.bookings.find(x => x.id === req.bookingId)!
  req.status = accept ? 'accepted' : 'rejected'
  if (accept) {
    for (let i = 0; i < req.people; i++) {
      b.members.push({
        id: `m-merge-${++seq.member}`,
        name: i === 0 ? req.walkerName : `${req.walkerName}同伴${i + 1}`,
        phone: req.walkerPhone,
        isCaptain: false,
        checkedIn: false,
        minor: req.minor
      })
    }
    b.headcount = b.members.length
    tl(b, `队长同意 ${req.walkerName} 等 ${req.people} 人拼场，照明费将按签到人数平摊（8 折，R-BOOK-2）`, 'success')
    notify('walkin', `拼场申请已通过：${b.teamName}，到场向队长出示即可签到`)
  } else {
    // 简化判定：填了正当理由则不罚
    const unreasonable = !reason.trim()
    req.unreasonable = unreasonable
    if (unreasonable) {
      if (!b.fees.some(f => f.kind === 'refuseMerge')) {
        b.fees.push({ kind: 'refuseMerge', label: '无正当理由拒绝拼场 · 资源占用费', amount: 20, ruleId: 'R-MERGE-1', note: `${req.walkerName} 等 ${req.people} 人申请被拒，队长未填写理由` })
      }
      b.credit = Math.max(0, b.credit - 5)
      tl(b, `拒绝 ${req.walkerName} 拼场且无正当理由：收资源占用费 20 元，信用 -5（R-MERGE-1）`, 'error')
      notify('walkin', `很遗憾，${b.teamName} 拒绝了拼场申请，可查看其他可拼队伍`)
    } else {
      tl(b, `拒绝拼场，理由：${reason}（系统登记为正当理由，不收费）`, 'default')
      notify('walkin', `${b.teamName} 未能接受拼场：${reason}`)
    }
  }
}

// ---------- 全场人数不足自动调整（R-MERGE-2） ----------
function underfillIncident(b: Booking) {
  return state.incidents.find(i => i.type === 'underfill' && i.bookingIds.includes(b.id))
}

/** 找到与某全场预约同时段占同场另一半区的预约（用于自动判定空闲半场是否真的空闲） */
function findFreeHalf(b: Booking): string | null {
  if (b.scope !== 'full' || b.halves.length < 2) return null
  const occupied = new Set<string>()
  for (const o of state.bookings) {
    if (o.id === b.id || o.courtId !== b.courtId || o.date !== b.date) continue
    if (['cancelled', 'noshow', 'rejected', 'finished', 'earlyLeave', 'sealed', 'rescheduled'].includes(o.status)) continue
    if (hm(o.start) < hm(b.end) && hm(o.end) > hm(b.start)) o.halves.forEach(h => occupied.add(h))
  }
  // 空闲半场取编号靠后者（演示稳定：H3+H4 → 释放 H4）
  const free = b.halves.slice().sort().filter(h => !occupied.has(h))
  return free[free.length - 1] ?? null
}

/** 系统自动检测：全场签到不足 6 人且有候补 → 发起调整提示；保留截止前催办 */
export function syncTimeEffects() {
  for (const b of state.bookings) {
    if (b.scope !== 'full' && !b.underfill) continue
    const view = underfillView(b, state.mergeRequests, nowStr.value)
    if (!view) continue
    // 自动发起提示
    if (view.shouldPrompt) {
      const deadline = hmLabel(hm(nowStr.value) + UNDERFILL_KEEP_MINUTES)
      b.underfill = {
        stage: 'prompted',
        promptedAt: nowStr.value,
        decideDeadline: deadline,
        waitingRequestIds: view.waiting.map(r => r.id)
      }
      tl(b, `系统检测：全场仅 ${view.present} 人签到（建议 8 人），${view.waitingPeople} 名散客正在等待。请在 ${deadline} 前选择：接受拼场 / 降为半场 / 补缴全场保留费（R-MERGE-2）`, 'warning')
      notify('captain', `【人数不足调整】${b.teamName} 全场仅 ${view.present} 人，请在 10 分钟内选择拼场、降半场或补缴（R-MERGE-2）`)
      const inc = underfillIncident(b)
      if (inc) {
        inc.status = 'mediating'
        inc.actions.push({ at: nowStr.value, by: 'admin', text: `系统自动发起人数不足调整提示，队长保留选择时限至 ${deadline}（R-MERGE-2）` })
      }
    }
    // 保留截止前 3 分钟催办一次
    const u = b.underfill
    if (u && u.stage === 'prompted' && !u.reminded && hm(nowStr.value) >= hm(u.decideDeadline) - 3) {
      u.reminded = true
      notify('captain', `【催办】${b.teamName} 请在 ${u.decideDeadline} 前选择，超时管理员将释放空闲半场给候补散客（R-MERGE-2）`)
      tl(b, `系统催办：距保留截止 ${u.decideDeadline} 不足 3 分钟，超时管理员可释放空闲半场（R-MERGE-2）`, 'warning')
    }
    // 释放后：结束前 5 分钟向双方推送结束提醒（重新生成）
    if (u && u.stage === 'released' && !u.endReminded &&
        hm(nowStr.value) >= hm(b.end) - 5 && hm(nowStr.value) < hm(b.end)) {
      u.endReminded = true
      const wb = state.bookings.find(x => x.id === u.walkerBookingId)
      tl(b, `结束提醒：距 ${b.end} 不足 5 分钟，请准备清场、关灯并按边界撤场（R-OT-1）`, 'warning')
      if (wb) {
        if (wb.underfill) wb.underfill.endReminded = true
        tl(wb, `结束提醒：距 ${wb.end} 不足 5 分钟，请准备清场、关灯，勿越过中线（R-OT-1）`, 'warning')
      }
      notify('captain', `【结束提醒】${b.teamName} 将于 ${b.end} 结束，请准备清场关灯`)
      notify('walkin', '【结束提醒】你的半场即将结束，请准备清场关灯')
    }
  }
}

/** 队长三选一：merge=接受拼场 downgrade=降为半场 keep=补缴保留全场 */
export function decideUnderfill(bookingId: string, choice: 'merge' | 'downgrade' | 'keep') {
  const b = state.bookings.find(x => x.id === bookingId)!
  const court = state.courts.find(c => c.id === b.courtId)!
  const view = underfillView(b, state.mergeRequests, nowStr.value)!
  const inc = underfillIncident(b)

  if (choice === 'merge') {
    // 接受全部在场候补：加入队伍并接受拼场（全场照明 8 折、按签到人数平摊）
    b.acceptMerge = true
    let added = 0
    for (const req of view.waiting) {
      for (let i = 0; i < req.people; i++) {
        b.members.push({
          id: `m-merge-${++seq.member}`,
          name: i === 0 ? req.walkerName : `${req.walkerName}同伴${i + 1}`,
          phone: req.walkerPhone,
          isCaptain: false,
          checkedIn: false,
          minor: req.minor
        })
        added++
      }
      req.status = 'accepted'
    }
    b.headcount = b.members.length
    b.underfill = { ...b.underfill!, stage: 'merge', note: '队长选择接受散客拼场' }
    tl(b, `队长选择接受拼场：${added} 名候补散客加入，双方共用全场，照明费 8 折并按签到人数平摊（R-BOOK-2 / R-MERGE-2）`, 'success')
    notify('walkin', `拼场已通过：${b.teamName}（全场），到场向队长出示即可签到，照明费按人平摊 8 折`)
    if (inc) {
      inc.actions.push({ at: nowStr.value, by: 'captain', text: `队长选择①接受拼场：${added} 名散客并入苍狼队共用全场，照明 8 折按签到人数平摊，投诉异议解决（R-MERGE-2）` })
      inc.status = 'resolved'
      inc.ruleApplied = ['R-MERGE-2', 'R-BOOK-2']
      inc.penalty = '无（双方拼场共用，场地利用率恢复）'
    }
  } else if (choice === 'downgrade') {
    // 降为半场（不立即让给散客的情形：队员留在原半场，另一半场进入候补，可由管理员释放）
    downgradeToHalf(b, inc, '队长选择②降为半场')
    notify('walkin', `${b.teamName} 已降为半场，空闲半场将由管理员分配给候补散客（R-MERGE-2）`)
  } else {
    // 补缴全场保留费，继续独占全场
    if (!b.fees.some(f => f.kind === 'fullKeep')) {
      b.fees.push({ kind: 'fullKeep', label: '全场人数不足 · 全场保留费', amount: FULL_KEEP_FEE, ruleId: 'R-MERGE-2', note: '队长选择继续独占全场（实际 4 人使用）' })
    }
    b.underfill = { ...b.underfill!, stage: 'keep', note: '队长补缴全场保留费，继续独占全场' }
    tl(b, `队长选择③补缴全场保留费 ${FULL_KEEP_FEE} 元，继续独占全场至 ${b.end}；费用与候补结果已同步工单（R-MERGE-2）`, 'warning')
    notify('captain', `已收取全场保留费 ${FULL_KEEP_FEE} 元，你可继续使用全场`)
    if (inc) {
      inc.actions.push({ at: nowStr.value, by: 'captain', text: `队长选择③补缴全场保留费 ${FULL_KEEP_FEE} 元继续独占全场；已向候补散客答复并建议其改排其他空闲半场（R-MERGE-2 / R-FAIR-3）` })
      inc.status = 'resolved'
      inc.ruleApplied = ['R-MERGE-2', 'R-FAIR-3']
      inc.penalty = `队长缴纳全场保留费 ${FULL_KEEP_FEE} 元；候补散客由管理员协助改排，可在工单查看答复`
    }
  }
  void court
}

/** 把全场预约降为半场：保留一个半场（取编号靠前者），照明改按 1 半场，退押金差额 */
function downgradeToHalf(b: Booking, inc: Incident | undefined, reason: string) {
  const keepHalf = b.halves.slice().sort()[0] // H3+H4 → 保留 H3
  const removedHalves = b.halves.filter(h => h !== keepHalf)
  // 固化降半场前的全场照明费（按已开灯分钟、全场 2 半场、无 8 折）
  const court = state.courts.find(c => c.id === b.courtId)!
  const prevQuote = lightQuote(b, court, nowStr.value)
  const prevMinutes = prevQuote?.minutes ?? 0
  const prevFee = Math.round((prevQuote?.gross ?? 0) * 100) / 100 // 降半场前不享受拼场折扣
  b.fees = b.fees.filter(f => f.kind !== 'lighting')
  if (prevFee > 0) {
    b.fees.push({
      kind: 'lighting',
      label: `照明费（${b.lighting.onAt}–${nowStr.value} 全场 ${prevMinutes} 分钟，降半场前）`,
      amount: prevFee, ruleId: 'R-LIGHT-1', locked: true,
      note: '降为半场前按全场 2 半场计，已固化'
    })
    b.lighting.fee = Math.round((b.lighting.fee + prevFee) * 100) / 100
  }
  // 改为半场
  b.scope = 'half'
  b.halves = [keepHalf]
  // 照明从此刻起按 1 个半场重新计量（之前全场部分已固化）
  b.lighting.meterFrom = nowStr.value
  // 押金 100 → 50，差额当场退还
  const diff = Math.max(0, b.lighting.deposit - 50)
  if (diff > 0) {
    b.lighting.deposit = 50
    b.fees.push({ kind: 'downgradeRefund', label: '降为半场 · 全场/半场押金差额退还', amount: -diff, ruleId: 'R-MERGE-2', note: `全场押金 100 元 − 半场押金 50 元，让出 ${removedHalves.join('/')}` })
  }
  // 候补申请标记为待释放分配（仍 pending，等待管理员释放空闲半场）
  b.underfill = {
    ...b.underfill!,
    stage: 'downgrade',
    releasedHalf: removedHalves[0],
    note: reason
  }
  tl(b, `${reason}：降为半场 ${keepHalf}，让出 ${removedHalves.join('/')}；${nowStr.value} 起照明按 1 个半场计费，全场/半场押金差额 ${diff} 元当场退还（R-MERGE-2）`, 'success')
  if (inc) {
    inc.actions.push({ at: nowStr.value, by: 'captain', text: `${reason}，保留 ${keepHalf}、让出 ${removedHalves.join('/')}；${nowStr.value} 起照明按 1 半场计，押金差额 ${diff} 元当场退还，空闲半场待管理员释放给候补散客（R-MERGE-2）` })
  }
}

/**
 * 管理员释放空闲半场给候补散客（队长拒绝调整且超保留时间，或队长已降半场）。
 * 生成散客半场预约，重划中线边界、照明分摊与结束提醒。
 */
export function releaseIdleHalf(bookingId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const inc = underfillIncident(b)
  const view = underfillView(b, state.mergeRequests, nowStr.value)
  const court = state.courts.find(c => c.id === b.courtId)!

  // 情形一：队长超期未选（仍为全场 prompted）→ 系统先按"降半场"处理，再释放另一半场
  let releasedHalf: string
  if (b.scope === 'full') {
    if (!view || !view.releaseable) return
    releasedHalf = findFreeHalf(b) ?? b.halves.slice().sort()[1]
    downgradeToHalf(b, inc, '队长超保留时间未选择，管理员释放空闲半场')
  } else {
    // 已降半场：释放登记的空闲半场
    releasedHalf = b.underfill?.releasedHalf ?? findFreeHalf({ ...b, halves: [b.halves[0]] } as Booking) ?? ''
  }
  const teamHalf = b.halves[0]

  // 取候补申请分配到释放半场：优先待处理，其次被队长拒绝但仍在场等待的候补组（R-MERGE-2）
  const waitingIds = b.underfill?.waitingRequestIds ?? []
  const candidates = state.mergeRequests
    .filter(r => r.bookingId === b.id && waitingIds.includes(r.id) && !r.reallocatedTo)
    .filter(r => r.status === 'pending' || r.status === 'rejected')
    .sort((a, c) => a.time.localeCompare(c.time))
  const req = candidates.find(r => r.status === 'pending') ?? candidates[0]
  if (!req) return

  // 固化原队降半场/释放时刻的全场照明已在 downgradeToHalf 处理；此处创建散客半场预约
  const wb: Booking = {
    id: nextId('B'),
    code: String(100000 + Math.floor(Math.random() * 899999)),
    courtId: b.courtId,
    halves: [releasedHalf],
    scope: 'half',
    date: b.date,
    start: nowStr.value,
    end: b.end,
    actualStart: nowStr.value,
    headcount: req.people,
    acceptMerge: true,
    teamName: `候补散客（${req.walkerName}组）`,
    captainId: 'u-walker',
    captainName: req.walkerName,
    captainPhone: req.walkerPhone,
    members: [],
    status: 'ongoing',
    payStatus: 'depositPaid',
    checkInCode: '',
    lockerNos: [],
    // 现场分配即由管理员开启该半场照明，独立按 1 半场计费（拼场 8 折、按签到人数平摊）
    lighting: { enabled: true, onAt: nowStr.value, meterFrom: nowStr.value, minutes: 0, fee: 0, deposit: 50 },
    fees: [
      { kind: 'lighting', label: '照明费（释放半场独立计量，按签到人数 8 折平摊）', amount: 0, ruleId: 'R-LIGHT-1' }
    ],
    credit: 100,
    timeline: [],
    splitFromId: b.id,
    isWalkerAllocation: true
  }
  wb.checkInCode = wb.code
  for (let i = 0; i < req.people; i++) {
    wb.members.push({
      id: `m-alloc-${++seq.member}`,
      name: i === 0 ? req.walkerName : `${req.walkerName}同伴${i + 1}`,
      phone: req.walkerPhone,
      isCaptain: i === 0,
      checkedIn: true,
      checkInAt: nowStr.value,
      minor: req.minor
    })
  }
  state.bookings.push(wb)
  req.status = 'accepted'
  req.reallocatedTo = wb.id

  // 原队进入 released：登记边界对组
  b.underfill = {
    ...b.underfill!,
    stage: 'released',
    releasedHalf,
    walkerBookingId: wb.id,
    confirmedByTeam: false,
    confirmedByWalker: false
  }
  wb.underfill = {
    stage: 'released',
    promptedAt: b.underfill.promptedAt,
    decideDeadline: b.underfill.decideDeadline,
    waitingRequestIds: [req.id],
    releasedHalf,
    walkerBookingId: wb.id,
    confirmedByTeam: false,
    confirmedByWalker: false
  }

  tl(b, `管理员释放空闲半场 ${releasedHalf} 给候补散客（${req.walkerName} 等 ${req.people} 人，签到码 ${wb.code}）：中线重新划定边界——本队使用 ${teamHalf}、散客使用 ${releasedHalf}；本队照明按 1 半场计，散客半场照明独立计费、各自平摊；${b.end} 同步结束并提醒清场（R-MERGE-2）`, 'warning')
  tl(wb, `管理员现场分配 ${releasedHalf} 半场（${nowStr.value}–${b.end}）：与${b.teamName}以中线为界，请勿越界；照明独立按 1 半场 0.8 折平摊，押金 50 元已收，签到码 ${wb.code}；${b.end} 结束请准时关灯清场（R-MERGE-2 / R-DISPUTE-1）`, 'success')
  notify('walkin', `已为你分配 ${court.name.replace('河滨公园灯光球场', '河滨')} ${releasedHalf} 半场，签到码 ${wb.code}，请确认中线边界`)
  notify('captain', `空闲半场 ${releasedHalf} 已释放给候补散客，请在页面确认中线边界与照明分摊`)

  if (inc) {
    inc.bookingIds = [...inc.bookingIds, wb.id]
    inc.actions.push({ at: nowStr.value, by: 'admin', text: `管理员释放 ${releasedHalf} 给候补散客 ${req.walkerName} 等 ${req.people} 人（新预约 ${wb.id}，${nowStr.value}–${b.end}）：重新划定中线边界（${b.teamName} 用 ${teamHalf}、散客用 ${releasedHalf}），照明各自按 1 半场独立计费平摊，${b.end} 同步结束提醒；待双方页面确认边界后办结（R-MERGE-2 / R-DISPUTE-1 / R-FAIR-3）` })
    inc.status = 'mediating'
    inc.ruleApplied = ['R-MERGE-2']
  }
}

/** 双方确认中线边界 / 照明分摊；双方都确认后工单办结，避免拼场后争抢 */
export function confirmBoundary(bookingId: string, by: 'team' | 'walker') {
  const b = state.bookings.find(x => x.id === bookingId)!
  const pairId = b.splitFromId ?? b.underfill?.walkerBookingId
  const other = state.bookings.find(x => x.id === pairId)
  if (!b.underfill) return
  if (by === 'team') b.underfill.confirmedByTeam = true
  else b.underfill.confirmedByWalker = true
  if (other?.underfill) {
    if (by === 'team') other.underfill.confirmedByTeam = true
    else other.underfill.confirmedByWalker = true
  }
  const who = by === 'team' ? '原预约队伍' : '候补散客'
  tl(b, `${who}已确认中线边界与照明分摊（R-MERGE-2）`, 'success')
  if (other) tl(other, `${who}已确认中线边界与照明分摊（R-MERGE-2）`, 'success')

  const inc = state.incidents.find(i => i.type === 'underfill' &&
    (i.bookingIds.includes(b.id) || (other && i.bookingIds.includes(other.id))))
  const both = boundaryConfirmed(b)
  if (both) {
    notify('admin', `${b.teamName} 与候补散客均已确认边界，工单可办结`)
    if (inc) {
      inc.status = 'resolved'
      inc.ruleApplied = ['R-MERGE-2', 'R-DISPUTE-1', 'R-FAIR-3']
      inc.penalty = '双方已确认中线边界与照明分摊，各自独立使用、独立计费；越界占用按争抢篮筐处理（R-DISPUTE-1）'
      inc.actions.push({ at: nowStr.value, by: 'admin', text: '双方均已在页面确认中线边界、照明分摊与结束时间，异议解决、工单办结（R-MERGE-2 / R-DISPUTE-1）' })
    }
  } else if (inc) {
    inc.actions.push({ at: nowStr.value, by: by === 'team' ? 'captain' : 'walkin', text: `${who}确认中线边界与照明分摊，等待另一方确认（R-MERGE-2）` })
  }
}

/** 候补散客在同一工单提交投诉/异议（投诉入口随费用状态同步更新，R-FAIR-3） */
export function addUnderfillComplaint(bookingId: string, text: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  let inc = underfillIncident(b)
  if (!inc) {
    const c = state.courts.find(x => x.id === b.courtId)!
    inc = {
      id: nextId('I-'), type: 'underfill', courtId: c.id, bookingIds: [b.id],
      title: '候补散客对全场人数不足处置提出异议',
      desc: text, source: '候补散客页面提交', time: nowStr.value, status: 'mediating', actions: []
    }
    state.incidents.unshift(inc)
  } else {
    inc.desc += `\n【散客补充异议 ${nowStr.value}】${text}`
  }
  inc.status = 'mediating'
  inc.actions.push({ at: nowStr.value, by: 'walkin', text: `候补散客提交投诉/异议：${text}（社区工作人员 24 小时内答复，R-FAIR-3）` })
  tl(b, `候补散客通过投诉入口提交异议，已进入工单，社区 24 小时内答复（R-FAIR-3 / R-MERGE-2）`, 'warning')
  notify('worker', '新的散客异议：全场人数不足处置，请在事件工单中答复')
  return inc
}

// ---------- 照明与结算 ----------
export function payDeposit(bookingId: string) {  const b = state.bookings.find(x => x.id === bookingId)!
  const court = state.courts.find(c => c.id === b.courtId)!
  b.lighting.deposit = b.scope === 'full' ? 100 : court.lighting.deposit
  b.payStatus = 'depositPaid'
  tl(b, `照明押金 ${b.lighting.deposit} 元已支付`, 'success')
}

export function turnOnLight(bookingId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const court = state.courts.find(c => c.id === b.courtId)!
  if (b.lighting.deposit <= 0) payDeposit(bookingId)
  b.lighting.enabled = true
  b.lighting.onAt = nowStr.value
  if (!b.fees.some(f => f.kind === 'lighting')) {
    b.fees.push({ kind: 'lighting', label: '照明费（实时累计）', amount: 0, ruleId: 'R-LIGHT-1' })
  }
  if (b.status === 'booked') {
    b.status = 'ongoing'
    b.actualStart = b.actualStart ?? nowStr.value
  }
  tl(b, `照明开启（${b.scope === 'full' ? '全场按 2 个半场' : '半场'} ${court.lighting.pricePerMinute} 元/分钟${b.acceptMerge ? '，拼场 8 折' : ''}），开始计费`, 'info')
}

export interface SettleResult {
  charges: number
  refunds: number
  deposit: number
  balance: number
  needTopup: number
}

export function endUsage(bookingId: string, forced = false): SettleResult {
  const b = state.bookings.find(x => x.id === bookingId)!
  const court = state.courts.find(c => c.id === b.courtId)
  if (b.lighting.enabled && !b.lighting.offAt) b.lighting.offAt = nowStr.value
  const summary = feeSummary(b, court, nowStr.value)
  // 重写费用表：固化历史条目（如降半场前全场照明）+ 静态条目（去掉未固化 lighting 占位）+ 实时照明 + 迟到/超时
  const locked = b.fees.filter(f => f.locked)
  const statics = b.fees.filter(f => f.kind !== 'lighting')
  const items: FeeItem[] = [...locked, ...statics]
  if (summary.light) {
    const q = summary.light
    items.push({
      kind: 'lighting',
      label: `照明费 ${q.minutes} 分钟${b.scope === 'full' ? '（全场）' : '（半场）'}${q.rate < 1 ? ' × 拼场 8 折' : ''}，签到 ${checkedInCount(b)} 人平摊`,
      amount: Math.round(q.fee * 100) / 100,
      ruleId: 'R-LIGHT-1'
    })
    b.lighting.minutes = q.minutes
    b.lighting.fee = Math.round((locked.filter(f => f.kind === 'lighting').reduce((s, f) => s + f.amount, 0) + q.fee) * 100) / 100
  }
  for (const dyn of summary.items) {
    if (!statics.some(s => s.kind === dyn.kind)) items.push(dyn)
  }
  b.fees = items
  const early = hm(nowStr.value) < hm(b.end)
  const balance = Math.round((summary.deposit - summary.charges) * 100) / 100
  if (balance >= 0) {
    if (balance > 0) items.push({ kind: 'earlyRefund', label: `押金余额退回（1–3 个工作日原路退回）`, amount: -balance, ruleId: 'R-OT-1' })
    b.payStatus = balance > 0 ? 'refunded' : 'paid'
  } else {
    b.payStatus = 'deducted'
  }
  b.actualEnd = nowStr.value
  b.status = early ? 'earlyLeave' : 'finished'
  tl(b, forced
    ? `管理员强制结束使用并关灯：费用合计 ${summary.charges.toFixed(2)} 元，押金 ${summary.deposit} 元${balance < 0 ? `，需补缴 ${(-balance).toFixed(2)} 元` : `，退回 ${balance.toFixed(2)} 元`}`
    : `结束使用并关灯：实际使用至 ${nowStr.value}，照明 ${summary.light?.minutes ?? 0} 分钟，费用合计 ${summary.charges.toFixed(2)} 元${balance < 0 ? `，需补缴 ${(-balance).toFixed(2)} 元` : `，押金退回 ${balance.toFixed(2)} 元`}`,
    balance < 0 ? 'error' : 'success')
  return { charges: summary.charges, refunds: summary.refunds, deposit: summary.deposit, balance, needTopup: balance < 0 ? -balance : 0 }
}

export function topUp(bookingId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  b.payStatus = 'paid'
  tl(b, '离场前补缴完成，费用已结清', 'success')
}

/** 爽约释放（R-LATE-1 / R-FAIR-2） */
export function releaseBooking(bookingId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  b.status = 'noshow'
  b.credit = Math.max(0, b.credit - 10)
  if (b.lighting.deposit > 0) {
    b.fees.push({ kind: 'late', label: '超 20 分钟未签到 · 押金不退（爽约）', amount: b.lighting.deposit, ruleId: 'R-LATE-1' })
    b.payStatus = 'deducted'
  }
  tl(b, '管理员释放该半场给现场候补队伍：原预约记爽约，押金不退、信用 -10（R-LATE-1 / R-FAIR-2）', 'error')
  notify('admin', `${b.teamName} 场地已释放，可分配给候补散客`)
}

// ---------- 事件 / 调解 ----------
function act(incident: Incident, by: RoleId, text: string) {
  const a: IncidentAction = { at: nowStr.value, by, text }
  incident.actions.push(a)
  for (const bid of incident.bookingIds) {
    const b = state.bookings.find(x => x.id === bid)
    b?.timeline.push({ at: nowStr.value, text: `【${incident.title}】${text}`, tone: 'warning' })
  }
}

export function setIncidentStatus(id: string, status: IncidentStatus) {
  const inc = state.incidents.find(x => x.id === id)!
  inc.status = status
}

export function addIncidentAction(id: string, by: RoleId, text: string) {
  act(state.incidents.find(x => x.id === id)!, by, text)
}

/** 照明故障核验（R-LIGHT-3） */
export function resolveLightFault(id: string, choice: 'wait' | 'reschedule' | 'refund') {
  const inc = state.incidents.find(x => x.id === id)!
  const b = state.bookings.find(x => x.id === inc.bookingIds[0])!
  if (choice === 'wait') {
    inc.status = 'mediating'
    act(inc, 'admin', '现场核验照明故障属实：费用计时已冻结，已通知维修班（到场预计 20 分钟）。超 30 分钟未修复将赠同时长免费券并可再次选择改约/退款（R-LIGHT-3）')
  } else if (choice === 'reschedule') {
    b.status = 'rescheduled'
    b.payStatus = 'refunded'
    b.adminNote = '照明故障改约：明日（9/28）同时段河滨公园灯光球场 H3，享优先排位；押金 50 元全额退回，已冻结照明费免收（R-LIGHT-3）。'
    b.fees = b.fees.filter(f => f.kind !== 'lighting')
    b.fees.push({ kind: 'weather', label: '照明故障 · 押金全额退回 + 优先改约', amount: -b.lighting.deposit, ruleId: 'R-LIGHT-3' })
    b.lighting.fee = 0
    inc.status = 'resolved'
    inc.ruleApplied = ['R-LIGHT-3']
    inc.penalty = '无（场地方责任）'
    act(inc, 'admin', '核验属实：队伍选择改约河滨公园 H3（优先排位），照明费免收、押金 50 元全额退回')
    notify('captain', '照明故障处理完成：已为你改约，押金全额退回')
  } else {
    b.status = 'cancelled'
    b.payStatus = 'refunded'
    b.fees = b.fees.filter(f => f.kind !== 'lighting')
    b.fees.push({ kind: 'weather', label: '照明故障 · 全额退款', amount: -b.lighting.deposit, ruleId: 'R-LIGHT-3' })
    b.lighting.fee = 0
    inc.status = 'resolved'
    inc.ruleApplied = ['R-LIGHT-3']
    inc.penalty = '无（场地方责任）'
    act(inc, 'admin', '核验属实：队伍选择全额退款，照明费免收、押金 50 元原路退回，工单关闭')
  }
}

/** 噪声投诉处置（R-NOISE-1） */
export function resolveNoise(id: string, secondVerified: boolean) {
  const inc = state.incidents.find(x => x.id === id)!
  const b = state.bookings.find(x => x.id === inc.bookingIds[0])!
  if (!secondVerified) {
    inc.status = 'resolved'
    inc.penalty = '首次劝导，不予处罚'
    act(inc, 'worker', '现场劝导完成，音量已降至标准内；告知队长 24 小时内再次核实投诉将收取 50 元社区安宁费（R-NOISE-1）')
  } else {
    inc.status = 'penalized'
    b.fees.push({ kind: 'complaint', label: '24 小时内第 2 次噪声投诉核实 · 社区安宁费', amount: 50, ruleId: 'R-NOISE-1', note: '第 3 次将暂停预约资格 30 天' })
    b.credit = Math.max(0, b.credit - 5)
    inc.penalty = '收取社区安宁费 50 元、信用 -5；第 3 次暂停预约资格 30 天'
    act(inc, 'worker', '第 2 次现场核实噪声超标：收取社区安宁费 50 元，书面告知投诉居民处理结果并留痕（R-NOISE-1 / R-FAIR-3）')
    notify('captain', '噪声投诉已二次核实：收取 50 元社区安宁费，请注意控制音量')
  }
}

/** 未成年人处置（R-MINOR-1） */
export function resolveMinor(id: string) {
  const inc = state.incidents.find(x => x.id === id)!
  inc.status = 'resolved'
  inc.penalty = '不计收费；同队伍当月累计 3 次扣信用 5 分'
  act(inc, 'worker', '监护人已到场接回郑凯，登记离场时间；本次不计收费（R-MINOR-1）')
}

/** 封场（R-SEAL-1）。有关联预约时按预约所占半场局部封停，否则全场地封停 */
export function issueSealOrder(id: string, reason: string, recoverAt: string) {
  const inc = state.incidents.find(x => x.id === id)!
  const court = state.courts.find(c => c.id === inc.courtId)!
  const linkedHalves = [...new Set(
    inc.bookingIds.flatMap(bid => state.bookings.find(x => x.id === bid)?.halves ?? [])
  )]
  const fullSeal = linkedHalves.length === 0
  if (fullSeal) {
    court.sealed = true
    court.sealReason = `${reason}（预计 ${recoverAt} 恢复）`
  } else {
    court.sealedHalves = [...new Set([...(court.sealedHalves ?? []), ...linkedHalves])]
    court.sealReason = `${linkedHalves.join('/')} 封停：${reason}（预计 ${recoverAt} 恢复）`
  }
  inc.status = 'resolved'
  inc.ruleApplied = ['R-SEAL-1']
  act(inc, 'admin', `签发封场令：${reason}，范围 ${court.name}${fullSeal ? '全场' : linkedHalves.join('/')}，预计 ${recoverAt} 恢复；原因/范围/恢复时间已公示（R-SEAL-1）`)
  const targets = fullSeal
    ? state.bookings.filter(x => x.courtId === court.id && ['booked', 'ongoing', 'late', 'overtime'].includes(x.status))
    : state.bookings.filter(x => x.courtId === court.id &&
        ['booked', 'ongoing', 'late', 'overtime'].includes(x.status) &&
        x.halves.some(h => linkedHalves.includes(h)))
  for (const b of targets) {
    if (b.lighting.enabled) {
      b.lighting.offAt = nowStr.value
      b.fees = b.fees.filter(f => f.kind !== 'lighting')
    }
    b.status = 'sealed'
    b.payStatus = 'refunded'
    const refund = b.lighting.deposit
    if (refund > 0) b.fees.push({ kind: 'sealRefund', label: '封场 · 照明不计费，押金全额退回', amount: -refund, ruleId: 'R-SEAL-1' })
    b.adminNote = `因「${reason}」封场（${fullSeal ? '全场地' : linkedHalves.join('/')}）：本场中止/取消，押金费用全额退回，可免费改约并享优先排位（R-SEAL-1）。`
    tl(b, `管理员封场（${reason}）：照明不计费、押金全额退回，可免费改约优先排位（R-SEAL-1）`, 'error')
  }
  notify('all', `${court.name}${fullSeal ? '' : ' ' + linkedHalves.join('/')} 已封场：${reason}，预计 ${recoverAt} 恢复`)
}

/** 篮筐争议裁决（R-DISPUTE-1） */
export function ruleDispute(id: string, ruling: string) {
  const inc = state.incidents.find(x => x.id === id)!
  inc.status = 'resolved'
  inc.ruleApplied = ['R-DISPUTE-1']
  act(inc, 'admin', `裁决：${ruling}。依据预约码、签到记录与时段比对结果执行（R-DISPUTE-1），结论已同步双方并留痕`)
}

/** 通用新事件上报 */
export function reportIncident(type: IncidentType, courtId: string, bookingIds: string[], title: string, desc: string, source: string) {
  const inc: Incident = {
    id: nextId('I-'),
    type, courtId, bookingIds, title, desc, source,
    time: nowStr.value,
    status: 'open',
    actions: [{ at: nowStr.value, by: state.role === 'walkin' || state.role === 'captain' ? state.role : 'worker', text: `${source} 上报：${desc}` }]
  }
  state.incidents.unshift(inc)
  for (const bid of bookingIds) {
    const b = state.bookings.find(x => x.id === bid)
    b && tl(b, `新事件：${title}，等待管理员/社区工作人员核验`, 'warning')
  }
  notify('admin', `新事件上报：${title}`)
  return inc
}

/** 天气：发布暂停/恢复使用（R-WX-1） */
export function setSurface(courtId: string, surface: Court['surface'], note: string) {
  const c = state.courts.find(x => x.id === courtId)!
  c.surface = surface
  notify('all', `${c.name}：${note}`)
}

/** 管理员改约（R-FAIR-4） */
export function adminReschedule(bookingId: string, newStart: string, newEnd: string, reason: string, compensate: number) {
  const b = state.bookings.find(x => x.id === bookingId)!
  b.status = 'rescheduled'
  b.adminNote = `管理员改约至 ${newStart}–${newEnd}。理由：${reason}（依据 R-FAIR-4 优先级排序），补偿 ${compensate} 元，新时段优先排位。`
  if (compensate > 0) b.fees.push({ kind: 'reschedule', label: `改约补偿（${reason}）`, amount: -compensate, ruleId: 'R-FAIR-4' })
  b.payStatus = 'refunding'
  tl(b, `管理员改约 ${newStart}–${newEnd}：${reason}；补偿 ${compensate} 元、新时段优先排位（R-FAIR-4）`, 'warning')
}

// ---------- 选择器 ----------
export function courtById(id: string) {
  return state.courts.find(c => c.id === id)!
}
export function bookingById(id: string) {
  return state.bookings.find(b => b.id === id)
}
export function lightLive(b: Booking) {
  const court = state.courts.find(c => c.id === b.courtId)
  const faultIncident = state.incidents.some(i => i.type === 'lightFault' && i.bookingIds.includes(b.id) && (i.status === 'open' || i.status === 'mediating'))
  return lightQuote(b, court, nowStr.value, faultIncident)
}
export { feeSummary }
