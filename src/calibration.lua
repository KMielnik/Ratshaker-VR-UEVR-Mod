-- Saved wrist calibration through UEVR's data-directory JSON API.
-- Only numeric poses and one bounded request are read; no commands/code execute.
local M={}
function M.new(env)
 local IK,codec=env.IK,env.json
 local V,Q=IK.vector,IK.quaternion
 local self={remaining=nil,request_id=nil,next_poll=0,status="Default grip alignment",loaded=false}
 local file="ratshaker_wrist_calibration.json"
 local request_file="ratshaker_calibration_request.json"
 local function log(s)self.status=s;if env.log then env.log("Calibration: "..s)end end
 local function read(path)
  if not codec or not codec.load_file then return nil end
  local ok,data=pcall(codec.load_file,path)
  return ok and type(data)=="table" and data or nil
 end
 local function offsets(data)
  if type(data)~="table" or data.version~=1 or type(data.wrists)~="table" then return nil end
  local result={}
  for _,side in ipairs({"left","right"})do
   local q=data.wrists[side]
   if type(q)~="table" then return nil end
   for _,axis in ipairs({"x","y","z","w"})do
    if type(q[axis])~="number" or q[axis]~=q[axis] or math.abs(q[axis])>1 then return nil end
   end
   local ok,unit=pcall(Q.normalize,q);if not ok then return nil end
   result[side]=unit
  end
  return result
 end
 function self:load(target)
  local value=offsets(read(file))
  if value then for side,q in pairs(value)do target[side]=q end;log("Saved wrist angles loaded")end
  self.loaded=true
  -- Consume the previous request at startup; a restart must not recalibrate.
  local old=read(request_file);self.request_id=old and old.id or nil
 end
 function self:request(delay)
  self.remaining=math.max(1,math.min(10,tonumber(delay)or 3));self.due=false
  log("Hold hands forward, palms facing each other, thumbs up; look forward")
 end
 function self:poll(time,dt,ready)
  if time>=self.next_poll then
   self.next_poll=time+1
   local request=read(request_file)
   if request and type(request.id)=="string" and #request.id<=100 and request.id~=self.request_id then
    self.request_id=request.id;self:request(request.delay)
   end
  end
  if self.remaining and ready then
   self.remaining=self.remaining-math.max(0,math.min(dt or 0,.1))
   if self.remaining<=0 then self.remaining=nil;self.due=true end
  end
 end
 function self:apply(tracked,head_rotation,references,target)
  if not self.due then return false end
  if not tracked.left or not tracked.right then return false end
  local forward=Q.rotate(head_rotation,V.new(1,0,0));forward.z=0
  if V.length(forward)<.2 then log("Look forward before calibration");return false end
  local yaw=Q.shortest_arc(V.new(1,0,0),V.normalize(forward))
  local result={}
  for _,side in ipairs({"left","right"})do
   local ref=references[side]
   local desired=Q.multiply(yaw,IK.palm_basis_offset(ref.forward,ref.radial))
   result[side]=IK.palm_offset(tracked[side].Rotation,desired)
  end
  for side,q in pairs(result)do target[side]=q end
  self.due=false
  local saved=false
  if codec and codec.dump_file then
   local ok,value=pcall(codec.dump_file,file,{version=1,wrists=result},4);saved=ok and value==true
  end
  log(saved and "Wrist angles calibrated and saved" or "Wrist angles calibrated for this session; save unavailable")
  return true
 end
 return self
end
return M
