/*
 * 业务断言冒烟测试（Node 执行）：全场人数不足自动调整（R-MERGE-2）
 * 用法（经 esbuild 打包后）：node tmp/smoke.mjs <scenario>
 * 每个 scenario 独立进程运行，保证初始 mock 状态干净。
 */
import {
  useState, nowStr, tick, resetClock,
  decideUnderfill, releaseIdleHalf, confirmBoundary,
  addUnderfillComplaint, endUsage, syncTimeEffects, feeSummary
} from '../src/store'
import { lightQuote, underfillView, boundaryConfirmed, money } from '../src/lib/engine'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`)
    process.exit(1)
  }
  passed++
  console.log(`  ✓ ${msg}`)
}
function approx(a: number, b: number, eps = 0.01) { return Math.abs(a - b) <= eps }

const state = useState()
const scenario = process.argv[2]
resetClock()

function b011() { return state.bookings.find(b => b.id === 'B011')! }
function court3() { return state.courts.find(c => c.id === 'court-3')! }
function i007() { return state.incidents.find(i => i.id === 'I-007')! }
function mr4() { return state.mergeRequests.find(r => r.id === 'MR-4')! }
function walkerBooking() { return state.bookings.find(b => b.splitFromId === 'B011') }

// ---- 场景 1：队长三选一之③补缴全场保留费 ----
if (scenario === 'keep') {
  const b = b011()
  const v = underfillView(b, state.mergeRequests, nowStr.value)!
  assert(v.present === 4, 'B011 实际签到 4 人')
  assert(v.waitingPeople === 4, '候补散客 4 人等待')
  assert(v.keepRemaining === 8, '19:42 距保留截止 19:50 还剩 8 分钟')
  assert(!v.releaseable, '保留时间内管理员不可释放')

  decideUnderfill('B011', 'keep')
  assert(!!b.fees.find(f => f.kind === 'fullKeep' && f.amount === 30), '收取全场保留费 30 元（R-MERGE-2）')
  assert(b.underfill!.stage === 'keep', '调整阶段=keep')
  assert(i007().status === 'resolved', '队长补缴后散客异议工单办结')

  addUnderfillComplaint('B011', '队长占着空半场不合理')
  assert(i007().status === 'mediating', '散客再投诉后工单回到处理中（投诉入口随时可用，R-FAIR-3）')
  assert(i007().actions.some(a => a.text.includes('占着空半场')), '投诉内容写入工单时间线')

// ---- 场景 2：队长②降半场 → 管理员释放 H4 → 双方确认 → 分段结算 ----
} else if (scenario === 'downgrade-release') {
  const b = b011()
  decideUnderfill('B011', 'downgrade')
  assert(b.scope === 'half' && b.halves.join() === 'H3', '原全场队降为半场 H3')
  assert(b.lighting.deposit === 50, '押金由全场 100 改为半场 50')
  const refund = b.fees.find(f => f.kind === 'downgradeRefund')
  assert(!!refund && refund.amount === -50, '全场/半场押金差额 50 元当场退还')
  const locked = b.fees.find(f => f.kind === 'lighting' && f.locked)
  assert(!!locked && approx(locked.amount, 78), '降半场前全场照明固化：39 分钟 ×2 半场 ×1.0 = 78 元')
  assert(b.lighting.meterFrom === '19:42', '照明从 19:42 起按半场重新计量')
  assert(b.underfill!.stage === 'downgrade', '调整阶段=downgrade，空闲半场待释放')

  releaseIdleHalf('B011')
  const wb = walkerBooking()
  assert(!!wb, '释放后生成散客半场预约')
  assert(wb!.halves.join() === 'H4' && wb!.scope === 'half', '散客分得 H4 半场')
  assert(wb!.splitFromId === 'B011' && wb!.isWalkerAllocation, '散客预约与原全场队建立边界对组')
  assert(mr4().status === 'accepted' && mr4().reallocatedTo === wb!.id, '候补 MR-4 标记已分配到新预约')
  assert(b.underfill!.stage === 'released', '原队调整阶段=released')
  assert(wb!.lighting.enabled && wb!.lighting.deposit === 50, '散客半场现场开灯、押金 50 元、独立计费')
  assert(wb!.members.length === 4 && wb!.members.every(m => m.checkedIn), '散客 4 人全部签到')
  assert(i007().bookingIds.includes(wb!.id), '工单关联散客新预约')

  confirmBoundary('B011', 'team')
  assert(b.underfill!.confirmedByTeam && !b.underfill!.confirmedByWalker, '原队已确认、散客未确认')
  assert(i007().status === 'mediating', '仅一方确认时工单仍处理中（防止拼场后争抢）')
  confirmBoundary(wb!.id, 'walker')
  assert(boundaryConfirmed(b) && boundaryConfirmed(wb!), '双方均已确认中线边界')
  assert(i007().status === 'resolved', '双方确认后工单自动办结')

  // 推到 20:55 → 结束提醒；再到 21:00 → 各自结算
  while (nowStr.value !== '20:55') tick(1)
  assert(b.underfill!.endReminded && wb!.underfill!.endReminded, '结束前 5 分钟双方均收到清场提醒')
  tick(5) // 21:00
  const rb = endUsage('B011')
  const rw = endUsage(wb!.id)
  assert(approx(rb.charges, 156), '原队结算=固化全场 78 + 半场 78 分钟×1.0=78，合计 156 元')
  assert(rb.needTopup === 106, '原队押金 50 不足，需补缴 106 元')
  assert(approx(rw.charges, 62.4), '散客半场照明 78 分钟 ×0.8 折 = 62.4 元')
  assert(approx(rw.needTopup, 12.4), '散客押金 50，需补缴 12.4 元')

// ---- 场景 3：队长超时未选 → 系统提示/催办 → 管理员释放 ----
} else if (scenario === 'timeout-release') {
  const b = b011()
  // 模拟重新检测：抹掉预置提示后由系统自动发起
  b.underfill = undefined
  syncTimeEffects()
  assert(!!b.underfill && b.underfill.stage === 'prompted', '系统自动检测全场人数不足并发起提示')
  assert(b.underfill.decideDeadline === '19:52', '19:42 发起，保留截止=19:52')

  releaseIdleHalf('B011')
  assert(b.scope === 'full' && !walkerBooking(), '保留时间内尝试释放被忽略')

  tick(10) // →19:52，19:49 自动催办
  assert(b.underfill!.reminded, '截止前 3 分钟自动催办队长')
  const v = underfillView(b, state.mergeRequests, nowStr.value)!
  assert(v.releaseable, '超过保留时间后管理员可释放空闲半场')

  releaseIdleHalf('B011')
  assert(b.scope === 'half' && b.halves.join() === 'H3', '超时释放时系统先降为半场 H3')
  const locked = b.fees.find(f => f.kind === 'lighting' && f.locked)
  assert(!!locked && approx(locked.amount, 98), '释放时刻固化全场照明：49 分钟 ×2 = 98 元')
  const wb = walkerBooking()
  assert(!!wb && wb!.halves.join() === 'H4', 'H4 当场分配给候补散客')
  assert(wb!.start === '19:52', '散客半场从释放时刻起用至 21:00')

// ---- 场景 4：队长①接受散客拼场 ----
} else if (scenario === 'merge') {
  const b = b011()
  decideUnderfill('B011', 'merge')
  assert(b.acceptMerge, '队伍改为接受拼场')
  assert(b.members.length === 8, '4 名候补散客并入，总名单 8 人')
  assert(mr4().status === 'accepted', '候补申请通过')
  assert(b.underfill!.stage === 'merge', '调整阶段=merge')
  assert(i007().status === 'resolved', '拼场成功后工单办结')
  const q = lightQuote(b, court3(), '20:00')!
  assert(q.rate === 0.8, '拼场后全场照明享 8 折')
  assert(approx(q.fee, 2 * 57 * 1.0 * 0.8, 0.01), '20:00 时全场照明 57 分钟×2 半场×0.8=91.2 元')

// ---- 场景 5：未改动的既有核心计费回归 ----
} else if (scenario === 'core') {
  const b1 = state.bookings.find(b => b.id === 'B001')!
  const c1 = state.courts.find(c => c.id === 'court-1')!
  const q = lightQuote(b1, c1, '19:42')!
  assert(approx(q.minutes, 97), '晨光队照明已用 97 分钟')
  assert(approx(q.fee, 62.08), '照明费 97×0.8×0.8 拼场折=62.08 元')
  assert(approx(q.perPerson, 10.35, 0.01), '6 名签到人均摊 10.35 元')
  const b2 = state.bookings.find(b => b.id === 'B002')!
  assert(!!b2.fees.find(f => f.kind === 'refuseMerge' && f.amount === 20), '无理由拒拼 20 元资源占用费仍在')
  assert(money(62.08) === '62.08', '金额格式化正常')

} else {
  console.error(`未知场景: ${scenario}`)
  process.exit(1)
}

console.log(`\n[${scenario}] ALL ASSERTIONS PASSED (${passed})`)
