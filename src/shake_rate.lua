-- Physical motion to native shake ticks. Position is absolute tracking meters.
-- Does not modify the meter: the adapter dispatches these integer credits to
-- the game's IncrementShakeCounterAndDetectIfShaking function on its game thread.
local M={}
function M.new(Motion,options)
 options=options or {}
 local self={detector=Motion.new({min_speed=options.min_speed or .22,release_speed=.10,
  min_acceleration=options.min_acceleration or 1.8,max_speed=12,max_displacement=.45,
  activity_hold=.20}),credit=0,units_per_meter=options.units_per_meter or 4.5,
  max_rate=options.max_rate or 9,last_rate=0}
 function self:reset() self.detector:reset();self.credit=0;self.last_rate=0 end
 function self:step(position,dt,trigger,grip,tracked)
  local squeeze=trigger and grip
  local r=self.detector:step(position,dt,trigger,squeeze,tracked)
  local count,rate=0,0
  if r.active and trigger and not squeeze then
   -- Speed supplies traveled distance; filtered acceleration rewards sharper
   -- reversals. Both increase with faster reciprocation at equal amplitude.
   local acceleration_factor=1+math.min(1.5,(r.acceleration or 0)/16)
   rate=math.min(self.max_rate,(r.speed or 0)*self.units_per_meter*acceleration_factor)
   if (r.speed or 0)<self.detector.cfg.release_speed then rate=0 end
   self.credit=self.credit+rate*math.min(dt,.05)
   count=math.min(3,math.floor(self.credit))
   self.credit=math.min(1,self.credit-count)
  elseif not trigger or squeeze or tracked==false or r.reason=="invalid_dt" or r.reason=="tracking_jump" or r.reason=="invalid_position" then
   self.credit=0
  end
  self.last_rate=rate
  r.count=count;r.rate=rate;r.mode=trigger and not squeeze;r.squeeze=squeeze
  return r
 end
 return self
end
return M
