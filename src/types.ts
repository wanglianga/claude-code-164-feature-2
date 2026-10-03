// ============ 领域类型定义 ============

export type RoleId = 'captain' | 'walkin' | 'admin' | 'worker'

export interface Role {
  id: RoleId
  name: string
  emoji: string
  desc: string
}

/** 场地地面状况 */
export type SurfaceStatus = 'good' | 'wet' | 'slippery' | 'repair'
/** 篮筐状态 */
export type HoopStatus = 'normal' | 'maintaining' | 'sealed'

export interface Court {
  id: string
  name: string
  park: string
  /** 可划分半场数量（全场 = 2 个半场） */
  halfCourts: number
  surface: SurfaceStatus
  /** 各篮筐状态，按半场编号 */
  hoops: Record<string, HoopStatus>
  /** 附近噪声敏感小区 */
  noiseSensitive: string[]
  /** 噪声截止时间（小时，22 表示 22:00 后须静音/关灯） */
  noiseCurfew: number
  lockersTotal: number
  lockersFree: number
  /** 照明元数据 */
  lighting: {
    available: boolean
    /** 每半场每分钟单价（元） */
    pricePerMinute: number
    /** 照明起步开启时间（小时，18 表示 18:00 起可开灯） */
    autoOnHour: number
    /** 押金（元） */
    deposit: number
    status: 'ok' | 'fault' | 'off'
  }
  /** 距离（米），仅展示用 */
  distanceM: number
  sealed: boolean
  sealReason?: string
  /** 部分封场（如仅封 H3/H4），为空表示全场地封停 */
  sealedHalves?: string[]
}

export type Scope = 'half' | 'full'
export type BookingStatus =
  | 'booked'        // 已预约待开始
  | 'ongoing'       // 进行中
  | 'finished'      // 正常结束
  | 'earlyLeave'    // 提前离场
  | 'late'          // 迟到（进行中但触发迟到规则）
  | 'overtime'      // 超时占用
  | 'cancelled'     // 取消
  | 'rescheduled'   // 被改约
  | 'sealed'        // 封场未使用
  | 'noshow'        // 爽约
  | 'rejected'      // 审核不通过

export type PayStatus = 'unpaid' | 'depositPaid' | 'paid' | 'refunding' | 'refunded' | 'deducted'

export interface Member {
  id: string
  name: string
  phone: string
  isCaptain: boolean
  checkedIn: boolean
  checkInAt?: string // HH:mm
  /** 未成年人需监护人陪同夜场 */
  minor?: boolean
}

/** 照明实际使用记录 */
export interface LightingUsage {
  enabled: boolean
  /** 实际开灯时间 HH:mm */
  onAt?: string
  /** 实际关灯时间 HH:mm（未关则按当前/结束时间计） */
  offAt?: string
  minutes: number
  fee: number
  deposit: number
  /** 缩场/释放分界时间：此前按全场计，此后该队只按所在半场计 */
  splitAt?: string
  /** 分界前的半场系数（全场=2）与折扣率（接受拼场 0.8） */
  factorBefore?: number
  rateBefore?: number
}

export type FeeItemKind =
  | 'lighting'      // 照明费
  | 'deposit'       // 押金
  | 'late'          // 迟到扣费
  | 'overtime'      // 超时占用费
  | 'refuseMerge'  // 拒绝拼场资源占用费
  | 'earlyRefund'  // 提前离场退还
  | 'weather'      // 天气/维修补偿
  | 'complaint'    // 噪声投诉处罚
  | 'sealRefund'   // 封场全额退款
  | 'reschedule'   // 改约补偿
  | 'surrender'    // 坚持包场（全场人数不足）资源占用费
  | 'halfAdjust'   // 缩场费用重算退还

export interface FeeItem {
  kind: FeeItemKind
  label: string
  amount: number   // 正=收取，负=退还/抵扣
  ruleId: string
  note?: string
}

export type IncidentType =
  | 'rain'            // 下雨地滑
  | 'repair'          // 临时维修
  | 'hoopDispute'     // 争抢篮筐
  | 'noise'           // 噪声投诉
  | 'minorNight'      // 未成年人夜间滞留
  | 'lightFault'      // 照明故障
  | 'seal'            // 管理员封场
  | 'late'            // 队伍迟到
  | 'overtime'        // 超时占用
  | 'refuseMerge'    // 拒绝拼场
  | 'halfRelease'    // 全场人数不足释放半场
  | 'boundary'       // 拼场后场地边界争议

export type IncidentStatus = 'open' | 'mediating' | 'resolved' | 'penalized'

export interface Incident {
  id: string
  type: IncidentType
  courtId: string
  bookingIds: string[]
  title: string
  desc: string
  source: string // 投诉人/上报人
  time: string   // HH:mm
  status: IncidentStatus
  /** 处置记录（时间线） */
  actions: IncidentAction[]
  /** 关联的费用/补偿条目，已在结算时写入 booking */
  ruleApplied?: string[]
  /** 后续处罚 */
  penalty?: string
  /** 队长对释放/缩场的申诉内容 */
  appeal?: { by: string; at: string; text: string }
  /** 管理员对申诉的裁决结论 */
  ruling?: string
}

export interface IncidentAction {
  at: string
  by: RoleId
  text: string
}

/**
 * 全场人数不足时的自动调整（R-MERGE-2 ~ R-MERGE-4）。
 * 状态机：
 *   prompting  页面提示队长三选一（接受拼场 / 降为半场 / 补缴全场差额），15 分钟保留期
 *   rejected   队长拒绝，保留期内不释放；超时后管理员可释放半场
 *   merging    队长选择接受拼场（候补散客加入同一全场）
 *   halved     队长主动降为半场，空出半场可分给候补
 *   surrendered 队长坚持包场并补缴全场差额
 *   released   队长拒绝且超保留期，管理员释放一个半场给散客
 *   confirmed  释放/缩场后双方均确认边界，流程闭环
 */
export type AdjustStatus =
  | 'prompting'
  | 'rejected'
  | 'merging'
  | 'halved'
  | 'surrendered'
  | 'released'
  | 'confirmed'

export interface AdjustChoice {
  /** 队长选择：拼场 / 半场 / 补差额 */
  choice: 'merge' | 'half' | 'surrender'
  at: string
}

export interface HalfAdjust {
  status: AdjustStatus
  /** 触发时间（判定人数不足、开始保留期） */
  promptedAt: string
  /** 保留期（分钟，默认 15） */
  holdMinutes: number
  /** 队长最近一次选择 */
  decision?: AdjustChoice
  /** 页面提示的可拼候补申请 id */
  candidateRequestIds: string[]
  /** 释放/缩场分界时间（照明分段计费用） */
  splitAt?: string
  /** 队长保留的半场；另一个半场被释放给散客 */
  keptHalf?: string
  /** 释放出去的半场 */
  freedHalf?: string
  /** 承接空半场而新建的散客半场预约 id */
  releasedBookingId?: string
  /** 释放半场关联的工单 id（投诉/申诉入口） */
  incidentId?: string
  /** 双方是否确认新的场地边界与照明分摊 */
  confirmedByCaptain?: boolean
  confirmedByWalker?: boolean
  /** 队长是否已提交申诉 */
  appealed?: boolean
}

/** 拼场申请 */
export interface MergeRequest {
  id: string
  bookingId: string
  walkerName: string
  walkerPhone: string
  people: number
  minor?: boolean
  message: string
  status: 'pending' | 'accepted' | 'rejected' | 'assigned'
  /** 队长拒绝是否被判为"无正当理由拒拼" */
  unreasonable?: boolean
  /** 释放半场后，候补散客被分配到的新半场预约 id */
  assignedBookingId?: string
  time: string
}

export interface Booking {
  id: string
  code: string
  courtId: string
  /** 使用的半场编号列表，全场占两个 */
  halves: string[]
  scope: Scope
  date: string        // YYYY-MM-DD
  start: string       // HH:mm
  end: string
  /** 实际开始 / 结束（迟到、提前离场、超时用） */
  actualStart?: string
  actualEnd?: string
  headcount: number
  acceptMerge: boolean
  teamName: string
  captainId: string
  captainName: string
  captainPhone: string
  members: Member[]
  status: BookingStatus
  payStatus: PayStatus
  lighting: LightingUsage
  fees: FeeItem[]
  /** 固定球队优先标识（公平性说明用） */
  fixedTeam?: boolean
  /** 历史履约信用分（初始 100） */
  credit: number
  /** 管理员改约/限制原因 */
  adminNote?: string
  /** 全场人数不足的自动调整流程 */
  adjust?: HalfAdjust
  /** 散客半场预约：承接自哪个被释放半场的全场预约 */
  releasedFromBookingId?: string
  /** 权益/核验时间线 */
  timeline: TimelineEvent[]
  /** 签到码 */
  checkInCode: string
  lockerNos?: number[]
}

export interface TimelineEvent {
  at: string
  text: string
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info'
}

export interface RuleText {
  id: string
  chapter: string
  title: string
  body: string
}
