/**
 * 规则引擎冒烟测试：用 esbuild 打包后在 Node 执行（不依赖浏览器）。
 * 覆盖全场人数不足的自动调整全链路（R-MERGE-2 ~ R-MERGE-4）。
 * 运行：npx esbuild scripts/smoke.ts --bundle --platform=node --format=esm --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs
 */
import {
  useState, resetClock, tick,
  chooseAdjust, rejectAdjust, releaseHalf, confirmAdjust,
  appealAdjust, ruleAdjustAppeal, walkerTurnOnLight, endUsage
} from '../src/store'
import { adjustView, lightQuote, checkedInCount, hm } from '../src/lib/engine'
import type { Booking, MergeRequest } from '../src/types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.error(`  ❌ ${name} ${extra}`) }
}
function approx(a: number, b: number, eps = 0.01) { return Math.abs(a - b) < eps }

const state = useState()

function makeMergeRequest(id: string, bookingId: string, name: string, people: number): MergeRequest {
  const r: MergeRequest = {
    id, bookingId, walkerName: name, walkerPhone: '150****0000', people,
    message: '测试候补', status: 'pending', time: '19:20'
  }
  state.mergeRequests.push(r)
  return r
}

function makeFullBooking(id: string, promptedAt: string, deposit = 100): Booking {
  const members = Array.from({ length: 4 }, (_, i) => ({
    id: `${id}-m${i}`, name: `队员${i}`, phone: '138****0000',
    isCaptain: i === 0, checkedIn: true, checkInAt: '19:02'
  }))
  const b: Booking = {
    id, code: id, courtId: 'court-3', halves: ['H1', 'H2'], scope: 'full',
    date: '2026-09-27', start: '19:00', end: '21:00', actualStart: '19:02',
    headcount: 4, acceptMerge: true, teamName: `测试队${id}`, captainId: 'u-t',
    captainName: '测试队长', captainPhone: '138****0000', members,
    status: 'ongoing', payStatus: 'depositPaid',
    lighting: { enabled: true, onAt: '19:03', minutes: 0, fee: 0, deposit },
    fees: [{ kind: 'lighting', label: '照明费', amount: 0, ruleId: 'R-LIGHT-1' }],
    credit: 100, timeline: [], checkInCode: id,
    adjust: { status: 'prompting', promptedAt, holdMinutes: 15, candidateRequestIds: [] }
  }
  state.bookings.push(b)
  return b
}

const court = state.courts.find(c => c.id === 'court-3')!

// ===== 1. 预置 B011：19:42 时保留期剩 3 分钟、不可释放 =====
resetClock()
const b011 = state.bookings.find(b => b.id === 'B011')!
const v0 = adjustView(b011, state.mergeRequests, '19:42')!
ok('B011 触发人数不足提示', b011.adjust?.status === 'prompting')
ok('B011 实际到场 4 人', checkedInCount(b011) === 4)
ok('B011 触发线 6、还差 2 人', v0.trigger === 6 && v0.shortBy === 2)
ok('B011 19:42 保留期剩 3 分钟', v0.remaining === 3)
ok('B011 保留期内管理员不可释放', v0.adminReleasable === false)
ok('B011 有 2 组候补散客', v0.candidates.length === 2)
const vOverdue = adjustView(b011, state.mergeRequests, '19:45')!
ok('B011 19:45 保留期届满 → 可释放', vOverdue.adminReleasable === true && vOverdue.holdOverdue)

// ===== 2. 队长选择接受拼场 =====
const bMerge = makeFullBooking('BT1', '19:30')
makeMergeRequest('MR-T1', 'BT1', '拼场散客甲', 3)
bMerge.adjust!.candidateRequestIds = ['MR-T1']
chooseAdjust('BT1', 'merge')
ok('选择拼场后状态 merging', bMerge.adjust!.status === 'merging')
ok('候补散客已加入同一名单（4+3=7）', bMerge.members.length === 7)
ok('拼场申请状态 accepted', state.mergeRequests.find(r => r.id === 'MR-T1')!.status === 'accepted')
ok('拼场保留全场两个半场', bMerge.halves.length === 2 && bMerge.scope === 'full')

// ===== 3. 队长主动降为半场：押金/照明重算 =====
const bHalf = makeFullBooking('BT2', '19:30')
chooseAdjust('BT2', 'half', 'H1')
ok('降半场后 scope=half、halves=[H1]', bHalf.scope === 'half' && bHalf.halves.join() === 'H1')
ok('降半场保留 H1、空出 H4→实际空 H2', bHalf.adjust!.keptHalf === 'H1' && bHalf.adjust!.freedHalf === 'H2')
ok('降半场全场押金 100→50', bHalf.lighting.deposit === 50)
ok('降半场产生 -50 押金差额退回', bHalf.fees.some(f => f.kind === 'halfAdjust' && f.amount === -50))
const qHalf = lightQuote(bHalf, court, '19:42')!
ok('降半场照明分段：39 分钟全场 8 折 = 62.40', approx(qHalf.fee, 62.4), `got ${qHalf.fee}`)
ok('降半场分段明细为 1 段（分界点当下）', qHalf.segments.length === 1)

// ===== 4. 队长拒绝且超保留期 → 管理员释放半场 =====
const bRel = makeFullBooking('BT3', '19:20')
makeMergeRequest('MR-T3', 'BT3', '王同学候补', 3)
bRel.adjust!.candidateRequestIds = ['MR-T3']
rejectAdjust('BT3', '我们还想等等队友')
ok('拒绝后状态 rejected', bRel.adjust!.status === 'rejected')
ok('拒绝但保留期内（19:20+15=19:35 已过 19:42）→ 可释放',
  adjustView(bRel, state.mergeRequests, '19:42')!.adminReleasable === true)
const { walker } = releaseHalf('BT3', 'H1', 'MR-T3')
ok('释放后原队缩为半场 H1', bRel.scope === 'half' && bRel.halves.join() === 'H1')
ok('释放状态 released、分界时间已记录', bRel.adjust!.status === 'released' && bRel.adjust!.splitAt === '19:42')
ok('原队信用 100→98（资源占用警示）', bRel.credit === 98)
ok('原队押金降为 50', bRel.lighting.deposit === 50)
ok('散客承接新半场 H2 半场预约', walker.halves.join() === 'H2' && walker.scope === 'half' && walker.releasedFromBookingId === 'BT3')
ok('散客 3 人已签到', checkedInCount(walker) === 3)
ok('候补申请标记 assigned 并关联新预约',
  state.mergeRequests.find(r => r.id === 'MR-T3')!.status === 'assigned' &&
  state.mergeRequests.find(r => r.id === 'MR-T3')!.assignedBookingId === walker.id)
const relInc = state.incidents.find(i => i.id === bRel.adjust!.incidentId)!
ok('生成释放半场工单，关联双方预约', relInc.type === 'halfRelease' && relInc.bookingIds.length === 2)
ok('工单适用 R-MERGE-3 / R-MERGE-4', relInc.ruleApplied!.includes('R-MERGE-3') && relInc.ruleApplied!.includes('R-MERGE-4'))
walkerTurnOnLight(walker.id)
ok('散客半场自付照明押金并开灯', walker.lighting.enabled && walker.lighting.deposit === 50)

// ===== 5. 双方确认边界 =====
ok('释放后默认双方均未确认',
  !bRel.adjust!.confirmedByCaptain && !bRel.adjust!.confirmedByWalker)
confirmAdjust('BT3', 'walker')
ok('散客先确认 → 队长仍待确认', bRel.adjust!.confirmedByWalker && !bRel.adjust!.confirmedByCaptain && bRel.adjust!.status === 'released')
confirmAdjust('BT3', 'captain')
ok('双方均确认 → 状态 confirmed', bRel.adjust!.confirmedByCaptain && bRel.adjust!.status === 'confirmed')

// ===== 6. 释放后照明分段：释放前后费率不同 =====
const qRel = lightQuote(bRel, court, '19:42')!
ok('释放原队照明分段（39 分全场 8 折）= 62.40', approx(qRel.fee, 62.4), `got ${qRel.fee}`)

// ===== 7. 申诉与管理员裁决 =====
const bApp = makeFullBooking('BT4', '19:15')
bApp.adjust!.status = 'rejected'
releaseHalf('BT4', 'H2')
appealAdjust('BT4', '当时已有队友在停车场，2 分钟即到，不认可释放')
ok('队长可对释放提交申诉', bApp.adjust!.appealed === true)
const appInc = state.incidents.find(i => i.id === bApp.adjust!.incidentId)!
ok('申诉写入工单且转为处理中', !!appInc.appeal && appInc.status === 'mediating')
ruleAdjustAppeal(appInc.id, '复核监控：19:42 时场内确为 4 人，释放合规，维持原决定')
ok('管理员裁决后工单办结并留结论', appInc.status === 'resolved' && !!appInc.ruling)

// ===== 8. 坚持包场：分界后全场原价、取消 8 折 =====
const bSur = makeFullBooking('BT5', '19:30')
chooseAdjust('BT5', 'surrender')
ok('坚持包场状态 surrendered、仍占全场', bSur.adjust!.status === 'surrendered' && bSur.scope === 'full')
ok('坚持包场取消拼场 8 折', bSur.acceptMerge === false)
const qSur0 = lightQuote(bSur, court, '19:42')!
ok('坚持包场当下（39 分全场 8 折）= 62.40', approx(qSur0.fee, 62.4), `got ${qSur0.fee}`)
tick(10) // 19:52
const qSur1 = lightQuote(bSur, court, '19:52')!
// 分界前 39 分 × 1.0 × 2 × 0.8 = 62.4；分界后 10 分 × 1.0 × 2 × 1.0 = 20
ok('坚持包场 19:52：62.40 + 20.00 = 82.40', approx(qSur1.fee, 82.4), `got ${qSur1.fee}`)
ok('坚持包场分界后分段费率=1、系数=2', qSur1.segments[1]?.rate === 1 && qSur1.segments[1]?.factor === 2)

// ===== 9. 降半场队伍结束结算：分段照明费条目 =====
const settle = endUsage('BT2')
const lightItem = bHalf.fees.find(f => f.kind === 'lighting')
ok('结算照明条目标注分段重算并引用 R-MERGE-4', !!lightItem && lightItem.ruleId === 'R-MERGE-4' && lightItem.label.includes('分段'))
ok('结算金额：39 分全场 62.4 + 10 分半场 8 折 8.0 = 70.40', approx(settle.charges, 70.4), `got ${settle.charges}`)
ok('押金 50 不足以抵扣，需补缴 20.40', approx(settle.needTopup, 20.4), `got ${settle.needTopup}`)

// ===== 10. 队长主动降半场：立即把空半场分给候补、无处罚无投诉工单 =====
const bVol = makeFullBooking('BT6', '19:40')
makeMergeRequest('MR-T6', 'BT6', '自愿候补乙', 2)
bVol.adjust!.candidateRequestIds = ['MR-T6']
chooseAdjust('BT6', 'half', 'H2')
ok('主动降半场信用不扣分（仍 100）', bVol.credit === 100)
ok('主动降半场已分配候补散客半场预约', !!bVol.adjust!.releasedBookingId)
const volWalker = state.bookings.find(x => x.id === bVol.adjust!.releasedBookingId)!
ok('散客承接空出半场 H1 且 2 人签到', volWalker.halves.join() === 'H1' && checkedInCount(volWalker) === 2)
ok('主动降半场不生成投诉工单', !state.incidents.some(i => i.bookingIds.includes('BT6')))
ok('主动降半场后可双方确认',
  (() => { confirmAdjust('BT6', 'captain'); confirmAdjust('BT6', 'walker'); return bVol.adjust!.status === 'confirmed' })())
void hm

console.log(`\n冒烟测试结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
