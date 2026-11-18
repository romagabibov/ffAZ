import '../../locales/activity';
import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { User } from '../../types';
import { 
 BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, 
 ResponsiveContainer, CartesianGrid, Legend 
} from 'recharts';
import { 
 FileText, Table, FileDown, Activity, Clock, Calendar, TrendingUp, 
 Users, Sparkles, Zap, ArrowUpRight 
} from 'lucide-react';
import type { UserActivityDataPoint, ActivitySummary } from './userStatsExport';
import { getTimestampMillis } from '../../lib/dateUtils';
import { toast } from 'sonner';

interface UserActivityChartsProps {
 users: User[];
}

type TimeframeType = 'day' | 'week' | 'month';
type ChartType = 'bar' | 'area';

export default function UserActivityCharts({ users }: UserActivityChartsProps) {
 const { t, i18n } = useTranslation();
 const language = i18n.resolvedLanguage || 'az';
 const [timeframe, setTimeframe] = useState<TimeframeType>('day');
 const [chartType, setChartType] = useState<ChartType>('bar');
 const [isExporting, setIsExporting] = useState<string | null>(null);

 const { hourlyData, weeklyData, monthlyData, summary } = useMemo(() => {
   const hour = 60 * 60 * 1000;
   const day = 24 * hour;
   const bakuOffset = 4 * hour;
   const now = Date.now();
   const bucket = (label: string): UserActivityDataPoint => ({ label, activeUsers: 0, newUsers: 0 });
   const hourlyData = Array.from({ length: 24 }, (_, i) => bucket(`${String(i).padStart(2, '0')}:00`));
   const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
   const weeklyData = Array.from({ length: 7 }, (_, index) => bucket(weekday.format(new Date(Date.UTC(2024, 0, index + 1)))));
   const currentDay = Math.floor((now + bakuOffset) / day);
   const monthlyData = Array.from({ length: 30 }, (_, index) => {
     const date = new Date((currentDay - 29 + index) * day);
     return bucket(date.toLocaleDateString(language, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }));
   });
   const summary: ActivitySummary = {
     peakHour: '—', peakHourCount: 0, peakDay: '—', peakDayCount: 0, dau: 0, wau: 0, mau: 0,
   };

   function record(millis: number, metric: 'activeUsers' | 'newUsers') {
     if (!millis || millis > now) return;
     const elapsed = now - millis;
     const bakuDate = new Date(millis + bakuOffset);
     if (elapsed < day) hourlyData[bakuDate.getUTCHours()][metric]++;
     if (elapsed < 7 * day) weeklyData[(bakuDate.getUTCDay() + 6) % 7][metric]++;
     const index = 29 - (currentDay - Math.floor((millis + bakuOffset) / day));
     if (monthlyData[index]) monthlyData[index][metric]++;
     if (metric === 'activeUsers') {
       if (elapsed < day) summary.dau++;
       if (elapsed < 7 * day) summary.wau++;
       if (elapsed < 30 * day) summary.mau++;
     }
   }

   for (const user of users) {
     const created = getTimestampMillis(user.createdAt);
     record(Math.max(getTimestampMillis(user.lastActiveAt), getTimestampMillis(user.lastLoginAt), created), 'activeUsers');
     record(created, 'newUsers');
   }
   for (const point of hourlyData) {
     if (point.activeUsers > summary.peakHourCount) {
       summary.peakHour = point.label;
       summary.peakHourCount = point.activeUsers;
     }
   }
   for (const point of weeklyData) {
     if (point.activeUsers > summary.peakDayCount) {
       summary.peakDay = point.label;
       summary.peakDayCount = point.activeUsers;
     }
   }
   return { hourlyData, weeklyData, monthlyData, summary };
 }, [users, language]);

 const currentChartData = timeframe === 'day' ? hourlyData : timeframe === 'week' ? weeklyData : monthlyData;

 const handleExport = async (type: 'txt' | 'excel' | 'pdf') => {
   setIsExporting(type);
   try {
     const exports = await import('./userStatsExport');
     const save = { txt: exports.exportUserStatsToTxt, excel: exports.exportUserStatsToExcel, pdf: exports.exportUserStatsToPdf }[type];
     await save(users, hourlyData, weeklyData, monthlyData, summary);
   } catch {
     toast.error(t('activity_export_failed'));
   } finally {
     setIsExporting(null);
   }
 };

 return (
 <div className="space-y-8">
 {/* Top Header with KPI Summary & Export Buttons */}
 <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 border-b-4 border-brand-dark pb-6">
 <div>
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-brand-accent text-white border-2 border-brand-dark">
 <Activity size={22} />
 </div>
 <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-brand-dark">
 {t('admin_activity_title')}
 </h2>
 </div>
 <p className="text-brand-dark/70 text-xs md:text-sm font-medium">
 {t('activity_intro')}
 </p>
 </div>

 {/* 3 Download Action Buttons (TXT, Excel, PDF) */}
 <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
 <button
 type="button"
 onClick={() => handleExport('txt')}
 disabled={isExporting !== null}
 className="flex-1 sm:flex-none px-4 py-2.5 bg-brand-light hover:bg-brand-muted border-2 border-brand-dark text-xs font-black uppercase tracking-wider text-brand-dark flex items-center justify-center gap-2 transition-all active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-50"
 title={t('activity_text')}
 >
 <FileText size={16} className="text-brand-dark" />
 <span>{isExporting === 'txt' ? t('activity_exporting') : t('activity_text')}</span>
 </button>

 <button
 type="button"
 onClick={() => handleExport('excel')}
 disabled={isExporting !== null}
 className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white border-2 border-brand-dark text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-50"
 title={t('activity_excel')}
 >
 <Table size={16} />
 <span>{isExporting === 'excel' ? t('activity_exporting') : t('activity_excel')}</span>
 </button>

 <button
 type="button"
 onClick={() => handleExport('pdf')}
 disabled={isExporting !== null}
 className="flex-1 sm:flex-none px-4 py-2.5 bg-brand-accent hover:bg-black text-white border-2 border-brand-dark text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-50"
 title={t('activity_pdf')}
 >
 <FileDown size={16} />
 <span>{isExporting === 'pdf' ? t('activity_exporting') : t('activity_pdf')}</span>
 </button>
 </div>
 </div>

 {/* Activity Metric Cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-5 shadow-xs">
 <div className="flex items-center justify-between text-brand-dark/60 mb-1">
 <span className="text-[10px] font-mono uppercase font-bold tracking-widest">{t('activity_peak_hour')}</span>
 <Clock size={14} className="text-brand-accent" />
 </div>
 <div className="text-xl md:text-2xl font-mono font-black text-brand-dark">{summary.peakHour}</div>
 <div className="text-[11px] font-bold text-brand-accent mt-0.5">
 {summary.peakHourCount} {t('activity_active_count')}
 </div>
 </div>

 <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-5 shadow-xs">
 <div className="flex items-center justify-between text-brand-dark/60 mb-1">
 <span className="text-[10px] font-mono uppercase font-bold tracking-widest">{t('activity_peak_day')}</span>
 <Calendar size={14} className="text-brand-accent" />
 </div>
 <div className="text-xl md:text-2xl font-mono font-black text-brand-dark">{summary.peakDay}</div>
 <div className="text-[11px] font-bold text-brand-accent mt-0.5">
 {summary.peakDayCount} {t('activity_peak_count')}
 </div>
 </div>

 <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-5 shadow-xs">
 <div className="flex items-center justify-between text-brand-dark/60 mb-1">
 <span className="text-[10px] font-mono uppercase font-bold tracking-widest">{t('activity_active_today')}</span>
 <TrendingUp size={14} className="text-brand-accent" />
 </div>
 <div className="text-xl md:text-2xl font-mono font-black text-brand-dark">{summary.dau}</div>
 <div className="text-[11px] font-medium text-brand-dark/60 mt-0.5">
 {((summary.dau / Math.max(1, users.length)) * 100).toFixed(0)}{t('activity_share')}
 </div>
 </div>

 <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-5 shadow-xs">
 <div className="flex items-center justify-between text-brand-dark/60 mb-1">
 <span className="text-[10px] font-mono uppercase font-bold tracking-widest">{t('activity_maus')}</span>
 <Users size={14} className="text-brand-accent" />
 </div>
 <div className="text-xl md:text-2xl font-mono font-black text-brand-dark">{summary.mau}</div>
 <div className="text-[11px] font-medium text-brand-dark/60 mt-0.5">
 {t('activity_user_count')} {users.length}
 </div>
 </div>
 </div>

 {/* Main Chart Card */}
 <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-6 md:p-8 shadow-xs">
 {/* Chart Toolbar Controls */}
 <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b border-brand-dark/[0.08] pb-4">
 <div className="flex items-center gap-2">
 <span className="text-xs font-mono font-black uppercase tracking-widest text-brand-dark">
 {t('activity_chart')}
 </span>
 <span className="px-2.5 py-0.5 bg-brand-accent/10 border border-brand-accent/20 text-brand-accent text-[10px] font-mono font-bold uppercase rounded-full">
 {timeframe === 'day' ? t('activity_chart_hourly') : timeframe === 'week' ? t('activity_chart_weekly') : t('activity_chart_monthly')}
 </span>
 </div>

 {/* Timeframe & Chart Style Switcher */}
 <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
 {/* Timeframe Filter (День / Неделя / Месяц) */}
 <div className="inline-flex border border-brand-dark/[0.08] bg-brand-muted/40 p-1 rounded-full">
 <button
 type="button"
 onClick={() => setTimeframe('day')}
 className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
 timeframe === 'day' ? 'bg-brand-dark text-white shadow-sm' : 'text-brand-dark hover:bg-brand-light'
 }`}
 >
 {t('activity_day')}
 </button>
 <button
 type="button"
 onClick={() => setTimeframe('week')}
 className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
 timeframe === 'week' ? 'bg-brand-dark text-white shadow-sm' : 'text-brand-dark hover:bg-brand-light'
 }`}
 >
 {t('activity_week')}
 </button>
 <button
 type="button"
 onClick={() => setTimeframe('month')}
 className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
 timeframe === 'month' ? 'bg-brand-dark text-white shadow-sm' : 'text-brand-dark hover:bg-brand-light'
 }`}
 >
 {t('activity_month')}
 </button>
 </div>

 {/* Bar vs Area view */}
 <div className="inline-flex border border-brand-dark/[0.08] bg-brand-muted/40 p-1 rounded-full">
 <button
 type="button"
 onClick={() => setChartType('bar')}
 className={`px-2.5 py-1.5 text-xs font-bold uppercase transition-colors cursor-pointer ${
 chartType === 'bar' ? 'bg-brand-accent text-white' : 'text-brand-dark hover:bg-brand-light'
 }`}
 title={t('activity_bars')}
 >
 {t('activity_bars')}
 </button>
 <button
 type="button"
 onClick={() => setChartType('area')}
 className={`px-2.5 py-1.5 text-xs font-bold uppercase transition-colors cursor-pointer ${
 chartType === 'area' ? 'bg-brand-accent text-white' : 'text-brand-dark hover:bg-brand-light'
 }`}
 title={t('activity_line')}
 >
 {t('activity_line')}
 </button>
 </div>
 </div>
 </div>

 {/* Axis Description Banner */}
 <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-brand-dark/70 mb-4 bg-brand-muted/30 p-3 rounded-2xl border border-brand-dark/[0.06]">
 <div className="flex items-center gap-2">
 <span className="font-bold uppercase text-brand-dark">{t('activity_axis_x')}</span>
 <span>
 {timeframe === 'day' 
 ? t('activity_axis_hours') 
 : timeframe === 'week' 
 ? t('activity_axis_days') 
 : t('activity_axis_month')}
 </span>
 </div>
 <div className="flex items-center gap-2">
 <span className="font-bold uppercase text-brand-dark">{t('activity_axis_y')}</span>
 <span>{t('activity_axis_users')}</span>
 </div>
 </div>

 {/* Responsive Recharts Container */}
 <div className="w-full h-[320px] md:h-[380px]">
 <ResponsiveContainer width="100%" height="100%">
 {chartType === 'bar' ? (
 <BarChart data={currentChartData} margin={{ top: 15, right: 15, left: -10, bottom: 25 }}>
 <CartesianGrid strokeDasharray="2 2" stroke="#e5e5e5" vertical={false} />
 <XAxis 
 dataKey="label" 
 tick={{ fontSize: 10, fontFamily: 'Space Mono, monospace', fill: 'var(--brand-dark)', fontWeight: 'bold' }} 
 interval={timeframe === 'day' ? 1 : 0}
 angle={timeframe === 'month' ? -45 : 0}
 textAnchor={timeframe === 'month' ? 'end' : 'middle'}
 tickLine={{ stroke: 'var(--brand-dark)', strokeWidth: 1.5 }}
 axisLine={{ stroke: 'var(--brand-dark)', strokeWidth: 2 }}
 />
 <YAxis 
 allowDecimals={false}
 tick={{ fontSize: 10, fontFamily: 'Space Mono, monospace', fill: 'var(--brand-dark)', fontWeight: 'bold' }}
 tickLine={{ stroke: 'var(--brand-dark)', strokeWidth: 1.5 }}
 axisLine={{ stroke: 'var(--brand-dark)', strokeWidth: 2 }}
 />
 <Tooltip 
 content={({ active, payload, label }) => {
 if (!active || !payload || !payload.length) return null;
 const data = payload[0].payload as UserActivityDataPoint;
 return (
 <div className="bg-brand-card rounded-2xl border border-brand-dark/[0.08] shadow-xl p-3.5 font-mono text-xs">
 <div className="font-black border-b border-brand-dark/20 pb-1 mb-2 text-brand-dark">
 {data.day ? `${data.day} (${label})` : t('activity_interval', { interval: label })}
 </div>
 <div className="flex items-center justify-between gap-4 text-brand-dark">
 <span className="font-bold">{t('activity_active')}</span>
 <span className="font-black text-brand-accent">{data.activeUsers}</span>
 </div>
 <div className="flex items-center justify-between gap-4 text-brand-dark/70 mt-1">
 <span>{t('activity_registrations')}</span>
 <span className="font-bold">{data.newUsers}</span>
 </div>

 </div>
 );
 }}
 />
 <Legend 
 verticalAlign="top" 
 align="right"
 wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }} 
 />
 <Bar 
 name={t('activity_active_label')} 
 dataKey="activeUsers" 
 fill="#7A0000" 
 stroke="#000000" 
 strokeWidth={1.5} 
 radius={[4, 4, 0, 0]} 
 />
 <Bar 
 name={t('activity_registrations_label')} 
 dataKey="newUsers" 
 fill="#111111" 
 stroke="#000000" 
 strokeWidth={1.5} 
 radius={[4, 4, 0, 0]} 
 />
 </BarChart>
 ) : (
 <AreaChart data={currentChartData} margin={{ top: 15, right: 15, left: -10, bottom: 25 }}>
 <defs>
 <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#7A0000" stopOpacity={0.4}/>
 <stop offset="95%" stopColor="#7A0000" stopOpacity={0.0}/>
 </linearGradient>
 <linearGradient id="colorNew" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#111111" stopOpacity={0.2}/>
 <stop offset="95%" stopColor="#111111" stopOpacity={0.0}/>
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="2 2" stroke="#e5e5e5" vertical={false} />
 <XAxis 
 dataKey="label" 
 tick={{ fontSize: 10, fontFamily: 'Space Mono, monospace', fill: 'var(--brand-dark)', fontWeight: 'bold' }} 
 interval={timeframe === 'day' ? 1 : 0}
 angle={timeframe === 'month' ? -45 : 0}
 textAnchor={timeframe === 'month' ? 'end' : 'middle'}
 tickLine={{ stroke: 'var(--brand-dark)', strokeWidth: 1.5 }}
 axisLine={{ stroke: 'var(--brand-dark)', strokeWidth: 2 }}
 />
 <YAxis 
 allowDecimals={false}
 tick={{ fontSize: 10, fontFamily: 'Space Mono, monospace', fill: 'var(--brand-dark)', fontWeight: 'bold' }}
 tickLine={{ stroke: 'var(--brand-dark)', strokeWidth: 1.5 }}
 axisLine={{ stroke: 'var(--brand-dark)', strokeWidth: 2 }}
 />
 <Tooltip 
 content={({ active, payload, label }) => {
 if (!active || !payload || !payload.length) return null;
 const data = payload[0].payload as UserActivityDataPoint;
 return (
 <div className="bg-brand-card rounded-2xl border border-brand-dark/[0.08] shadow-xl p-3.5 font-mono text-xs">
 <div className="font-black border-b border-brand-dark/20 pb-1 mb-2 text-brand-dark">
 {data.day ? `${data.day} (${label})` : t('activity_interval', { interval: label })}
 </div>
 <div className="flex items-center justify-between gap-4 text-brand-dark">
 <span className="font-bold">{t('activity_active')}</span>
 <span className="font-black text-brand-accent">{data.activeUsers}</span>
 </div>
 <div className="flex items-center justify-between gap-4 text-brand-dark/70 mt-1">
 <span>{t('activity_registrations')}</span>
 <span className="font-bold">{data.newUsers}</span>
 </div>
 </div>
 );
 }}
 />
 <Legend 
 verticalAlign="top" 
 align="right"
 wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }} 
 />
 <Area 
 type="monotone" 
 name={t('activity_active_label')} 
 dataKey="activeUsers" 
 stroke="#7A0000" 
 strokeWidth={3} 
 fillOpacity={1} 
 fill="url(#colorActive)" 
 />
 <Area 
 type="monotone" 
 name={t('activity_registrations_label')} 
 dataKey="newUsers" 
 stroke="#111111" 
 strokeWidth={2} 
 strokeDasharray="4 4"
 fillOpacity={1} 
 fill="url(#colorNew)" 
 />
 </AreaChart>
 )}
 </ResponsiveContainer>
 </div>
 </div>
 </div>
 );
}
