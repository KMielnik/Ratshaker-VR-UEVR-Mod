-- Pure Lua right-controller gesture detector. Position in absolute tracking
-- space meters. No headset pose, clock, runtime API, input injection or IO.
local M={}
local function finite(n) return type(n)=="number" and n==n and math.abs(n)<1e8 end
local function vec(x,y,z) return {x=x,y=y,z=z} end
local function sub(a,b) return vec(a.x-b.x,a.y-b.y,a.z-b.z) end
local function dot(a,b) return a.x*b.x+a.y*b.y+a.z*b.z end
local function mag(v) return math.sqrt(dot(v,v)) end
local function mul(v,s) return vec(v.x*s,v.y*s,v.z*s) end
local function blend(a,b,alpha) return vec(a.x+(b.x-a.x)*alpha,a.y+(b.y-a.y)*alpha,a.z+(b.z-a.z)*alpha) end
local function clamp(n,a,b) return math.max(a,math.min(b,n)) end
local function read(p)
 if type(p)~="table" then return nil end
 local x,y,z=p.x or p.X,p.y or p.Y,p.z or p.Z
 if not finite(x) or not finite(y) or not finite(z) then return nil end
 return vec(x,y,z)
end
local defaults={min_speed=.32,release_speed=.15,min_acceleration=2.5,
 velocity_tau=.035,acceleration_tau=.025,activity_hold=.22,max_dt=.10,
 max_displacement=.30,max_speed=5,strength_speed=1.5,reversal_dot=-.25,
 deceleration_dot=-.35,jitter_speed=.03}
local Detector={};Detector.__index=Detector
function M.new(options)
 local cfg={};for k,v in pairs(defaults) do cfg[k]=v end
 for k,v in pairs(options or {}) do assert(defaults[k]~=nil,"Unknown motion option "..tostring(k));assert(finite(v),"Invalid motion option");cfg[k]=v end
 assert(cfg.min_speed>cfg.release_speed and cfg.release_speed>=cfg.jitter_speed and cfg.jitter_speed>=0,"Invalid speed hysteresis")
 assert(cfg.velocity_tau>0 and cfg.acceleration_tau>0 and cfg.activity_hold>0 and cfg.max_dt>0 and cfg.max_displacement>0 and cfg.max_speed>0 and cfg.strength_speed>0 and cfg.min_acceleration>0,"Invalid motion thresholds")
 assert(cfg.reversal_dot>=-1 and cfg.reversal_dot<0 and cfg.deceleration_dot>=-1 and cfg.deceleration_dot<0,"Invalid directional thresholds")
 return setmetatable({cfg=cfg},Detector)
end
function Detector:reset()
 self.previous=nil;self.velocity=vec(0,0,0);self.acceleration=vec(0,0,0)
 self.last_direction=nil;self.remaining=0;self.last_strength=0
end
local function result(active,strength,reason,speed,accel,evidence,remaining)
 return {active=active,strength=strength,reason=reason,speed=speed or 0,
 acceleration=accel or 0,evidence=evidence,hold_remaining=remaining or 0}
end
function Detector:step(position,dt,armedRT,grip,tracked)
 if grip then self:reset();return result(false,0,"grip_priority") end
 if not armedRT then self:reset();return result(false,0,"not_armed") end
 if tracked==false then self:reset();return result(false,0,"tracking_lost") end
 if not finite(dt) or dt<=0 or dt>self.cfg.max_dt then self:reset();return result(false,0,"invalid_dt") end
 local p=read(position)
 if not p then self:reset();return result(false,0,"invalid_position") end
 if not self.previous then
  self:reset();self.previous=p;return result(false,0,"priming")
 end
 local delta=sub(p,self.previous);local displacement=mag(delta)
 local raw=mul(delta,1/dt);local rawspeed=mag(raw)
 if displacement>self.cfg.max_displacement or rawspeed>self.cfg.max_speed then
  self:reset();self.previous=p;return result(false,0,"tracking_jump")
 end
 self.previous=p;self.remaining=math.max(0,self.remaining-dt)
 local old_velocity=self.velocity
 if rawspeed<self.cfg.jitter_speed then raw=vec(0,0,0) end
 self.velocity=blend(old_velocity,raw,dt/(self.cfg.velocity_tau+dt))
 local instantaneous_accel=mul(sub(self.velocity,old_velocity),1/dt)
 self.acceleration=blend(self.acceleration,instantaneous_accel,dt/(self.cfg.acceleration_tau+dt))
 local speed,accel=mag(self.velocity),mag(self.acceleration)
 local evidence=nil
 if speed>=self.cfg.min_speed then
  if self.last_direction then
   local alignment=dot(self.velocity,self.last_direction)/(speed*mag(self.last_direction))
   if alignment<self.cfg.reversal_dot then evidence="reversal" end
  end
  -- Onset acceleration in the direction of travel cannot arm a shake by
  -- itself. Substantial deceleration or a reversal provides swing evidence.
  if not evidence and accel>=self.cfg.min_acceleration then
   local alignment=dot(self.velocity,self.acceleration)/(speed*accel)
   if alignment<self.cfg.deceleration_dot then evidence="deceleration" end
  end
  self.last_direction=self.velocity
 end
 local strength=clamp((speed-self.cfg.release_speed)/self.cfg.strength_speed,0,1)
 if evidence then
  self.remaining=self.cfg.activity_hold
  self.last_strength=math.max(.05,strength)
 elseif self.remaining>0 then
  self.last_strength=math.max(self.last_strength*math.exp(-dt/.35),strength)
 end
 local active=self.remaining>0
 -- Hold bridges the low-speed turnarounds of real back-and-forth motion.
 -- It expires deterministically even when the hand becomes stationary.
 if not active then self.last_strength=0 end
 return result(active,active and clamp(self.last_strength,0,1) or 0,
  active and "shake" or (speed<self.cfg.release_speed and "stationary" or "translation"),
  speed,accel,evidence,self.remaining)
end
M.defaults=defaults
return M
