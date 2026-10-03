import { computed, reactive, ref } from 'vue'
import type {
  Booking, Court, FeeItem, Incident, IncidentAction, IncidentStatus,
  IncidentType, Member, MergeRequest, RoleId, Scope, TimelineEvent, HalfAdjust
} from './types'
import { BOOKINGS, COURTS, INCIDENTS, MERGE_REQUESTS, NOW_HM, ROLES, TODAY } from './data/mock'
import { checkedInCount, feeSummary, hm, lightQuote, ADJUST_HOLD_MIN } from './lib/engine'

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

const idCounters: Record<string, number> = { B: 11, 'MR-': 5, I: 6 }
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

// ---------- 全场人数不足 · 自动调整（R-MERGE-2 ~ R-MERGE-4） ----------

/** 队长三选一：接受拼场 / 降为半场 / 补缴全场差额 */
export function chooseAdjust(bookingId: string, choice: 'merge' | 'half' | 'surrender', keptHalf?: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const a = b.adjust!
  a.decision = { choice, at: nowStr.value }

  if (choice === 'merge') {
    a.status = 'merging'
    b.acceptMerge = true
    tl(b, `队长选择「接受散客拼场」：候补散客加入同一全场，照明费按签到人数平摊并享 8 折（R-MERGE-2 / R-BOOK-2）`, 'success')
    // 自动通过候补申请并把散客加进同一队伍
    for (const reqId of a.candidateRequestIds) {
      const req = state.mergeRequests.find(r => r.id === reqId)
      if (req && req.status === 'pending') {
        req.status = 'accepted'
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
        notify('walkin', `拼场已通过：${b.teamName}（全场），到场向队长出示即可签到`)
      }
    }
    notify('captain', `已接受拼场，候补散客到场签到后全场人数补齐`)
  } else if (choice === 'half') {
    const kept = keptHalf ?? b.halves[0]
    const freed = b.halves.find(h => h !== kept)!
    a.status = 'halved'
    a.keptHalf = kept
    a.freedHalf = freed
    a.splitAt = nowStr.value
    b.scope = 'half'
    b.halves = [kept]
    b.lighting.splitAt = nowStr.value
    b.lighting.factorBefore = 2
    b.lighting.rateBefore = 0.8
    const court = state.courts.find(c => c.id === b.courtId)!
    const halfDeposit = court.lighting.deposit
    if (b.lighting.deposit > halfDeposit) {
      const diff = b.lighting.deposit - halfDeposit
      b.fees.push({ kind: 'halfAdjust', label: `降为半场 · 照明押金 ${b.lighting.deposit}→${halfDeposit}，差额当场退回`, amount: -diff, ruleId: 'R-MERGE-2' })
      b.lighting.deposit = halfDeposit
    }
    // 空出半场按候补顺位分配给散客（主动缩场无处罚、不生成投诉工单），进入双方确认
    const wb = assignFreedHalf(b, a, freed, nowStr.value)
    if (wb) {
      tl(b, `队长选择「降为半场」：保留 ${kept}，空出 ${freed} 已按候补顺位分给 ${wb.captainName} 等 ${wb.members.length} 人；照明按分界时间分段重算（此前全场、此后半场），押金差额原路退回；请双方确认新边界（R-MERGE-2 / R-MERGE-4）`, 'success')
      notify('walkin', `${freed} 半场已分给你（${wb.start}–${wb.end}），请凭签到码 ${wb.code} 到场并确认边界`)
    } else {
      tl(b, `队长选择「降为半场」：保留 ${kept}，空出 ${freed} 暂作现场排队候补（R-FAIR-2）；照明按分界时间分段重算，押金差额原路退回（R-MERGE-2）`, 'success')
      notify('walkin', `${freed} 半场已空出，现场散客可排队候补`)
    }
    notify('captain', `已降为半场（${kept}），照明与押金已按半场重算${wb ? '，请确认边界' : ''}`)
  } else {
    a.status = 'surrendered'
    a.splitAt = nowStr.value
    b.acceptMerge = false
    b.lighting.splitAt = nowStr.value
    b.lighting.factorBefore = 2
    b.lighting.rateBefore = 0.8
    const court = state.courts.find(c => c.id === b.courtId)!
    const toEndMin = Math.max(0, hm(b.end) - hm(nowStr.value))
    // 差额=分界后全场原价（2 半场）相对拼场 8 折的上浮：0.4 × 半场单价/分钟，已并入分段照明，不另立收费
    const diff = Math.round(toEndMin * court.lighting.pricePerMinute * 0.4 * 100) / 100
    tl(b, `队长选择「坚持包场」：自 ${nowStr.value} 起保留全场 ${b.halves.join('/')}、取消拼场 8 折，按全场 2 个半场原价计费，预计至 ${b.end} 比接受拼场多缴约 ${diff} 元（R-MERGE-2）`, 'warning')
    notify('captain', `已按全场原价续用至 ${b.end}，结束时结算；候补散客将被引导至其他场地`)
    // 通知候补散客
    for (const reqId of a.candidateRequestIds) {
      const req = state.mergeRequests.find(r => r.id === reqId)
      if (req && req.status === 'pending') notify('walkin', `${b.teamName} 选择坚持包场，已为你推荐其他可拼/候补场地`)
    }
  }
}

/** 队长在保留期内明确拒绝调整（未选择），保留期内不释放 */
export function rejectAdjust(bookingId: string, reason = '') {
  const b = state.bookings.find(x => x.id === bookingId)!
  const a = b.adjust!
  a.status = 'rejected'
  tl(b, `队长拒绝调整${reason ? `（理由：${reason}）` : ''}：保留期内不释放半场；若满 15 分钟仍未接受调整，管理员可释放一个半场给候补散客（R-MERGE-3）`, 'warning')
  notify('admin', `${b.teamName} 拒绝全场人数调整，保留期届满后可释放半场`)
}

/** 为空出的半场新建候补散客半场预约并关联候补申请（R-MERGE-3 / R-MERGE-4）；无候补返回 undefined */
function assignFreedHalf(b: Booking, a: HalfAdjust, freed: string, splitAt: string, leadRequestId?: string): Booking | undefined {
  const lead = (leadRequestId ? state.mergeRequests.find(r => r.id === leadRequestId) : undefined)
    ?? a.candidateRequestIds.map(id => state.mergeRequests.find(r => r.id === id)).find(r => r && r.status === 'pending')
  if (!lead) return undefined
  const walkerName = lead.walkerName
  const walkerPhone = lead.walkerPhone
  const people = lead.people

  const wb: Booking = {
    id: nextId('B'),
    code: String(100000 + Math.floor(Math.random() * 899999)),
    courtId: b.courtId,
    halves: [freed],
    scope: 'half',
    date: b.date,
    start: splitAt,
    end: b.end,
    actualStart: splitAt,
    headcount: people,
    acceptMerge: true,
    teamName: `${walkerName} 候补散客场`,
    captainId: 'u-walker',
    captainName: walkerName,
    captainPhone: walkerPhone,
    members: [],
    status: 'ongoing',
    payStatus: 'unpaid',
    checkInCode: '',
    releasedFromBookingId: b.id,
    lighting: { enabled: false, minutes: 0, fee: 0, deposit: 0 },
    fees: [],
    credit: 100,
    timeline: []
  }
  wb.checkInCode = wb.code
  for (let i = 0; i < people; i++) {
    wb.members.push({
      id: `m-rel-${++seq.member}`,
      name: i === 0 ? walkerName : `${walkerName}同伴${i + 1}`,
      phone: walkerPhone,
      isCaptain: i === 0,
      checkedIn: true,
      checkInAt: splitAt
    })
  }
  state.bookings.push(wb)
  a.releasedBookingId = wb.id

  lead.status = 'assigned'
  lead.assignedBookingId = wb.id
  a.candidateRequestIds = [...new Set([...(a.candidateRequestIds ?? []), lead.id])]
  return wb
}

/**
 * 管理员释放一个半场给候补散客（R-MERGE-3）。
 * 原队缩为保留半场，新建一条散客半场预约承接空半场，照明分段重算，
 * 同时生成含投诉/申诉入口的工单。
 */
export function releaseHalf(bookingId: string, keptHalf?: string, leadRequestId?: string): { booking: Booking; walker: Booking } {
  const b = state.bookings.find(x => x.id === bookingId)!
  const a = b.adjust!
  const court = state.courts.find(c => c.id === b.courtId)!
  const wasRejected = a.status === 'rejected'
  const kept = keptHalf ?? b.halves[0]
  const freed = b.halves.find(h => h !== kept)!
  const splitAt = nowStr.value

  a.status = 'released'
  a.keptHalf = kept
  a.freedHalf = freed
  a.splitAt = splitAt
  b.scope = 'half'
  b.halves = [kept]
  b.lighting.splitAt = splitAt
  b.lighting.factorBefore = 2
  b.lighting.rateBefore = 0.8
  b.credit = Math.max(0, b.credit - 2)

  // 全场押金降为半场押金，差额当场退回（费用结算时一并处理）
  const halfDeposit = court.lighting.deposit
  if (b.lighting.deposit > halfDeposit) {
    const diff = b.lighting.deposit - halfDeposit
    b.fees.push({ kind: 'halfAdjust', label: `释放半场 · 全场押金 ${b.lighting.deposit}→半场 ${halfDeposit}，差额当场退回`, amount: -diff, ruleId: 'R-MERGE-3' })
    b.lighting.deposit = halfDeposit
  }

  // 承接散客：优先指定候补申请，否则取顺位第一；均无则登记现场排队队伍（R-FAIR-2）
  let wb = assignFreedHalf(b, a, freed, splitAt, leadRequestId)
  if (!wb) {
    const walkup: MergeRequest = {
      id: nextId('MR-'), bookingId: b.id, walkerName: '现场排队散客', walkerPhone: '管理员现场登记',
      people: 4, message: '现场排队候补（管理员登记）', status: 'pending', time: nowStr.value
    }
    state.mergeRequests.unshift(walkup)
    a.candidateRequestIds = [walkup.id, ...a.candidateRequestIds]
    wb = assignFreedHalf(b, a, freed, splitAt, walkup.id)
  }
  const walker: Booking = wb!
  const walkerName = walker.captainName
  const people = walker.members.length

  // 工单（投诉/申诉入口）
  const inc = reportIncident(
    'halfRelease',
    b.courtId,
    [b.id, walker.id],
    `${b.teamName} 全场人数不足 · 释放 ${freed} 半场`,
    `${b.teamName} 预约全场但开场 15 分钟后仅 ${b.members.filter(m => m.checkedIn).length} 人到场，队长${wasRejected ? '拒绝调整' : '保留期内未完成选择'}，管理员依规则释放 ${freed} 半场，由候补散客 ${walkerName} 等 ${people} 人承接。分界时间 ${splitAt}：此前照明按全场计、此后原队按 ${kept} 半场计、${freed} 照明由散客自付。双方可在此提交异议/投诉，队长可 24 小时内申诉。`,
    '系统自动判定 + 管理员现场核验'
  )
  a.incidentId = inc.id
  inc.ruleApplied = ['R-MERGE-3', 'R-MERGE-4']
  inc.actions.push({
    at: nowStr.value,
    by: 'admin',
    text: `管理员现场核验后释放 ${freed}：原队保留 ${kept}（全场押金降为半场、差额退回，照明按 ${splitAt} 分段重算）；候补散客 ${walkerName} 等 ${people} 人承接 ${freed}，费用自付。费用重算明细与投诉/申诉入口已同步双方。`
  })

  tl(b, `管理员释放 ${freed} 半场给候补散客 ${walkerName} 等 ${people} 人：本队保留 ${kept}，照明自 ${splitAt} 分段重算，记资源占用警示、信用 -2；对释放有异议可在工单中 24 小时内申诉（R-MERGE-3）`, 'error')
  tl(walker, `承接释放半场 ${freed}（${splitAt}–${b.end}）：请与 ${b.teamName} 沿中线分区使用，并在页面确认场地边界与照明分摊（R-MERGE-4）`, 'success')

  notify('admin', `${freed} 已释放给候补散客，费用重算与投诉入口已同步双方`)
  notify('captain', `你保留 ${kept}，${freed} 已释放给散客；如有异议可在事件工单中申诉`)
  notify('walkin', `${freed} 半场已分配，请凭签到码 ${walker.code} 到场并确认边界`)

  return { booking: b, walker }
}

/** 双方确认新边界（R-MERGE-4） */
export function confirmAdjust(bookingId: string, who: 'captain' | 'walker') {
  const b = state.bookings.find(x => x.id === bookingId)!
  const a = b.adjust!
  if (who === 'captain') a.confirmedByCaptain = true
  else a.confirmedByWalker = true
  tl(b, who === 'captain' ? '队长已确认新的场地边界、照明分摊与结束提醒（R-MERGE-4）' : '散客方已确认新的场地边界、照明分摊与结束提醒（R-MERGE-4）', 'success')
  if (a.confirmedByCaptain && a.confirmedByWalker) {
    a.status = 'confirmed'
    tl(b, '双方均已确认边界，分区生效；确认后越界争抢将按争议规则处置并可暂停预约资格 7 天（R-MERGE-4 / R-DISPUTE-1）', 'success')
    notify('admin', `${b.teamName} 与候补散客均已确认边界，分区完成`)
  } else {
    notify('admin', `${b.teamName} 半场调整：${who === 'captain' ? '队长已确认，等待散客' : '散客已确认，等待队长'}确认`)
  }
}

/** 散客对承接半场支付照明押金并开灯（分界后自付） */
export function walkerTurnOnLight(bookingId: string) {
  const wb = state.bookings.find(x => x.id === bookingId)!
  const court = state.courts.find(c => c.id === wb.courtId)!
  wb.lighting.deposit = court.lighting.deposit
  wb.payStatus = 'depositPaid'
  wb.lighting.enabled = true
  wb.lighting.onAt = nowStr.value
  if (!wb.fees.some(f => f.kind === 'lighting')) {
    wb.fees.push({ kind: 'lighting', label: `照明费（${wb.halves.join('/')} 半场，实时累计）`, amount: 0, ruleId: 'R-LIGHT-1' })
  }
  tl(wb, `照明开启（半场 ${court.lighting.pricePerMinute} 元/分钟，拼场 8 折），开始计费（R-MERGE-4）`, 'info')
}

/** 队长对释放/缩场提交申诉（R-MERGE-3 投诉入口） */
export function appealAdjust(bookingId: string, text: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
  const a = b.adjust!
  a.appealed = true
  const inc = state.incidents.find(i => i.id === a.incidentId)
  if (inc) {
    inc.appeal = { by: b.captainName, at: nowStr.value, text }
    if (inc.status === 'open' || inc.status === 'resolved') inc.status = 'mediating'
    inc.actions.push({ at: nowStr.value, by: 'captain', text: `队长申诉：${text}` })
  }
  tl(b, `队长就半场释放提交申诉：${text}（等待管理员复核，R-MERGE-3）`, 'warning')
  notify('admin', `${b.teamName} 就半场释放提交申诉，请在事件工单中复核裁决`)
}

/** 管理员对释放半场申诉作出裁决 */
export function ruleAdjustAppeal(incidentId: string, ruling: string) {
  const inc = state.incidents.find(x => x.id === incidentId)!
  inc.ruling = ruling
  inc.status = 'resolved'
  inc.ruleApplied = Array.from(new Set([...(inc.ruleApplied ?? []), 'R-MERGE-3']))
  inc.actions.push({ at: nowStr.value, by: 'admin', text: `申诉复核裁决：${ruling}。结论已同步双方并留痕` })
  for (const bid of inc.bookingIds) {
    const b = state.bookings.find(x => x.id === bid)
    b?.timeline.push({ at: nowStr.value, text: `【${inc.title}】申诉裁决：${ruling}`, tone: 'warning' })
  }
  notify('captain', '你的半场释放申诉已完成复核，结论已同步')
}

/** 需要队长三选一的全场预约 */
export function shortageBookings(): Booking[] {
  return state.bookings.filter(b =>
    b.adjust && (b.adjust.status === 'prompting' || b.adjust.status === 'rejected') &&
    b.scope === 'full')
}

// ---------- 照明与结算 ----------
export function payDeposit(bookingId: string) {
  const b = state.bookings.find(x => x.id === bookingId)!
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
  // 重写费用表：静态条目（去掉旧 lighting 占位）+ 实时照明 + 迟到/超时
  const statics = b.fees.filter(f => f.kind !== 'lighting')
  const items: FeeItem[] = [...statics]
  if (summary.light) {
    const q = summary.light
    const split = b.lighting.splitAt
    const surrendered = b.adjust?.status === 'surrendered'
    items.unshift(split && q.segments.length > 1
      ? {
          kind: 'lighting' as const,
          label: surrendered
            ? `照明费分段计费 共 ${q.minutes} 分钟（${split} 起坚持包场·全场原价）`
            : `照明费分段重算 共 ${q.minutes} 分钟（分界 ${split}）`,
          amount: Math.round(q.fee * 100) / 100,
          ruleId: surrendered ? 'R-MERGE-2' : 'R-MERGE-4',
          note: q.segments.map(s => `${s.label} ${s.minutes}分×¥${court?.lighting.pricePerMinute ?? 0}${s.factor === 2 ? '×2半场' : ''}${s.rate < 1 ? '×8折' : ''}`).join('；')
        }
      : {
          kind: 'lighting' as const,
          label: `照明费 ${q.minutes} 分钟${b.scope === 'full' ? '（全场）' : ''}${q.rate < 1 ? ' × 拼场 8 折' : ''}，签到 ${checkedInCount(b)} 人平摊`,
          amount: Math.round(q.fee * 100) / 100,
          ruleId: 'R-LIGHT-1'
        })
    b.lighting.minutes = q.minutes
    b.lighting.fee = Math.round(q.fee * 100) / 100
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
