-- VR-only rendering adjustments. All calls run on the normal game-thread tick.
-- The original rat material is retained: its frame/choke/skin uniforms continue
-- to be owned by the game. Rat lighting is a bounded fill-light fallback, not an
-- unlit shader replacement. See docs/compatibility.md for coverage limits.
local M={}
-- SM5 shipped vertex shaders use floor(position / grid) * grid. A binary
-- power-of-two step avoids zero division and extra reciprocal rounding.
M.vertex_grid=1/1024
-- A strength of .5 halves the previous supplemental fill (intensity 4 -> 2).
-- Native scene lighting remains intact; this is not a shader-exact 50/50 mix.
M.fill_reference_intensity=4
M.max_photo_targets=8
M.photo_meshes={
 ["StaticMesh /Game/Ratshaker/LA/Props/Photo_Key/RS_SM_Photo_Key_Pieces_Plane_001.RS_SM_Photo_Key_Pieces_Plane_001"]={x=0,y=0,z=12.610867738723755},
 ["StaticMesh /Game/Ratshaker/LA/Props/Photo_Key/RS_SM_Photo_Key_Pieces_Plane_003.RS_SM_Photo_Key_Pieces_Plane_003"]={x=0,y=0,z=12.61086654663086},
 ["StaticMesh /Game/Ratshaker/LA/Props/Photo_Key/RS_SM_Photo_Key_Pieces_Plane_004.RS_SM_Photo_Key_Pieces_Plane_004"]={x=0,y=0,z=12.610867083072662},
 ["StaticMesh /Game/Ratshaker/LA/Props/Photo_Key/RS_SM_Photo_Key_Pieces_Plane_005.RS_SM_Photo_Key_Pieces_Plane_005"]={x=0,y=0,z=12.610868498682976},
}
M.snap_materials={
 ["Material /Game/Ratshaker/MAT/PSM/MT_PSM.MT_PSM"]=true,
 ["Material /Game/Ratshaker/CA/TheRat2D/SupporterPack/MT_Rat2D_V2.MT_Rat2D_V2"]=true,
 ["Material /Game/Ratshaker/CA/TheRat2D/MT_Rat2D_Tail.MT_Rat2D_Tail"]=true,
}
M.parameters={
 {path="/Game/Ratshaker/MAT/PP/VHSFilter/MPC_GlobalParams.MPC_GlobalParams",name="PixelSize",target=8192},
 {path="/Game/Ratshaker/MAT/PP/VHSFilter/MPC_VHSFilter.MPC_VHSFilter",name="Pixelate_Scale",target=8192},
}

function M.new(env)
 assert(env and env.uevr and env.call and env.valid and env.visuals and env.IK and env.write_transform,
  "rendering requires uevr/call/valid/visuals/IK/write_transform")
 local call,valid,V,Q=env.call,env.valid,env.IK.vector,env.IK.quaternion
 local self={pawn=nil,rat=nil,lights={},parameters={},saved_channels=nil,time=0,retry={},errors={},
  grid_parameter=nil,grid_materials={},grid_slots={},grid_queue={},grid_cursor=1,grid_count=0,
  photo_targets={},photo_retry={},photo_queue={},photo_cursor=1,photo_count=0,
  diagnostics={pixelation="pending",rat_lighting="pending",photo_lighting="pending",vertex_snap="pending"},
  cfg={pixel_resolution=8192,fill_strength=.5,fill_intensity=2}}
 local function log(s) if env.log then env.log("[Rendering] "..s) end end
 local function same(a,b) return valid(a) and valid(b) and a:get_address()==b:get_address() end
 local function class(n)
  local c=env.uevr.api:find_uobject("Class /Script/"..n)
  assert(valid(c),"Rendering class unavailable: "..n);return c
 end
 local function default(n) return class(n):get_class_default_object() end
 local function property(o,n)
  if not valid(o) or not o:get_class():find_property(n) then return nil end
  return o[n]
 end
 local function optional(o,n,...)
  if valid(o) and o:get_class():find_function(n) then return call(o,n,...) end
 end
 local function error_once(scope,err)
  err=tostring(err)
  if self.errors[scope]~=err then self.errors[scope]=err;log(scope..": "..err) end
  self.retry[scope]=self.time+5
 end
 local function material_library() return default("Engine.KismetMaterialLibrary") end
 local function restore_parameters()
  for i=#self.parameters,1,-1 do
   local p=self.parameters[i]
   if valid(p.world) and valid(p.asset) and p.saved~=nil then
    local ok,err=pcall(call,material_library(),"SetScalarParameterValue",p.world,p.asset,p.name,p.saved)
    if not ok then log("Restore "..p.name..": "..tostring(err)) end
   end
  end
  self.parameters={}
 end
 local function update_parameters()
  local lib=material_library()
  if #self.parameters==0 then
   for _,spec in ipairs(M.parameters) do
    local asset=env.visuals:load_asset(spec.path,"MaterialParameterCollection")
    local saved=call(lib,"GetScalarParameterValue",self.pawn,asset,spec.name)
    assert(type(saved)=="number" and saved==saved,"Invalid native pixelation parameter "..spec.name)
    self.parameters[#self.parameters+1]={asset=asset,world=self.pawn,name=spec.name,saved=saved,target=self.cfg.pixel_resolution}
   end
  end
  for _,p in ipairs(self.parameters) do
   local current=call(lib,"GetScalarParameterValue",self.pawn,p.asset,p.name)
   if math.abs(current-p.target)>.01 then call(lib,"SetScalarParameterValue",self.pawn,p.asset,p.name,p.target) end
   local readback=call(lib,"GetScalarParameterValue",self.pawn,p.asset,p.name)
   assert(math.abs(readback-p.target)<.01,"Pixelation parameter readback failed: "..p.name)
   p.readback=readback
  end
  if self.diagnostics.pixelation~="resolution parameters applied" then
   log("PixelSize="..self.parameters[1].readback.." (was "..self.parameters[1].saved..
    "), Pixelate_Scale="..self.parameters[2].readback.." (was "..self.parameters[2].saved..
    "); other postprocess controls unchanged; rendered comparison pending")
  end
  self.diagnostics.pixelation="resolution parameters applied"
 end
 -- Keep the snapping scope independent: an unavailable mesh API must not
 -- undo the known working pixelation fix or fill lights.
 local function finite(n) return type(n)=="number" and n==n and math.abs(n)<math.huge end
 local function restore_grid_slot(slot)
  if valid(slot.component) and valid(slot.source) and valid(slot.material) and
   same(call(slot.component,"GetMaterial",slot.index),slot.material) then
   call(slot.component,"SetMaterial",slot.index,slot.source)
  end
 end
 local function restore_grid_instances()
  for _,slot in pairs(self.grid_slots) do
   local ok,err=pcall(restore_grid_slot,slot)
   if not ok then log("Restore vertex material slot: "..tostring(err)) end
  end
  for _,p in pairs(self.grid_materials) do
   if not p.owned and valid(p.material) then
    local ok,err=pcall(call,p.material,"SetScalarParameterValue","CustomGridSize",p.saved)
    if not ok then log("Restore CustomGridSize: "..tostring(err)) end
   end
  end
  self.grid_materials={};self.grid_slots={};self.grid_count=0
  self.grid_queue={};self.grid_cursor=1;self.grid_scan_at=nil;self.grid_report=nil
 end
 local function restore_grid_parameter()
  local p=self.grid_parameter
  if p and valid(p.world) and valid(p.asset) then
   local ok,err=pcall(call,material_library(),"SetScalarParameterValue",p.world,p.asset,"GridSize",p.saved)
   if not ok then log("Restore GridSize: "..tostring(err)) end
  end
  self.grid_parameter=nil;self.grid_check_at=nil
 end
 local function restore_grid()
  restore_grid_instances();restore_grid_parameter()
 end
 local function update_grid_parameter()
  local lib=material_library()
  if not self.grid_parameter then
   local asset=env.visuals:load_asset(M.parameters[1].path,"MaterialParameterCollection")
   local saved=call(lib,"GetScalarParameterValue",self.pawn,asset,"GridSize")
   assert(finite(saved),"Invalid native GridSize")
   self.grid_parameter={world=self.pawn,asset=asset,saved=saved}
  end
  local p=self.grid_parameter
  local current=call(lib,"GetScalarParameterValue",p.world,p.asset,"GridSize")
  if not finite(current) or math.abs(current-M.vertex_grid)>1e-7 then
   call(lib,"SetScalarParameterValue",p.world,p.asset,"GridSize",M.vertex_grid)
  end
  local result=call(lib,"GetScalarParameterValue",p.world,p.asset,"GridSize")
  assert(finite(result) and math.abs(result-M.vertex_grid)<1e-7,"GridSize readback failed")
  if not p.readback then log("Vertex grid="..M.vertex_grid.." (was "..p.saved..
   "); fine positive step, not an exact shader bypass; material scan pending") end
  p.readback=result
 end
 local function snap_material(material)
  -- Explicit shipped-material allowlist, no name substring matching and no
  -- blanket WPO disabling (which could remove unrelated animation).
  local seen={}
  for _=1,8 do
   if not valid(material) then return false end
   local key=material:get_address()
   if seen[key] then return false end
   seen[key]=true
   if M.snap_materials[material:get_full_name()] then return true end
   material=property(material,"Parent")
  end
  return false
 end
 local function object_world(object)
  local worldclass=class("Engine.World")
  for _=1,8 do
   if not valid(object) then return nil end
   if same(object:get_class(),worldclass) then return object end
   object=object:get_outer()
  end
 end
 local function update_grid_material(material,owned)
  local key=material:get_address()
  local p=self.grid_materials[key]
  if not p then
   assert(self.grid_count<2048,"Vertex material limit reached (2048)")
   local saved=call(material,"K2_GetScalarParameterValue","CustomGridSize")
   assert(finite(saved),"Invalid native CustomGridSize")
   p={material=material,saved=saved,owned=owned}
   -- Record before the setter so a partial write can always be restored.
   self.grid_materials[key]=p;self.grid_count=self.grid_count+1
  end
  local current=call(material,"K2_GetScalarParameterValue","CustomGridSize")
  if not finite(current) or math.abs(current-M.vertex_grid)>1e-7 then
   call(material,"SetScalarParameterValue","CustomGridSize",M.vertex_grid)
  end
  local result=call(material,"K2_GetScalarParameterValue","CustomGridSize")
  assert(finite(result) and math.abs(result-M.vertex_grid)<1e-7,"CustomGridSize readback failed")
  p.readback=result
 end
 local function update_grid_component(component,world)
  if not valid(component) or not same(object_world(component),world) then return end
  local count=call(component,"GetNumMaterials")
  assert(finite(count) and count>=0 and count%1==0 and count<=16,"Vertex material slot limit exceeded (16)")
  for index=0,count-1 do
   local material=call(component,"GetMaterial",index)
   if valid(material) and snap_material(material) then
    local key=tostring(component:get_address())..":"..index
    local slot=self.grid_slots[key]
    -- A game replacement wins. Do not restore a stale material over it.
    if slot and not same(slot.material,material) then self.grid_slots[key]=nil;slot=nil end
    if material:get_class():find_function("SetScalarParameterValue") then
     update_grid_material(material,slot~=nil)
    else
     assert(self.grid_count<2048,"Vertex material limit reached (2048)")
     -- Only constant/source materials need a child MID. An existing native
     -- MID is always updated in place, preserving frame/choke/skin writers.
     local child=call(component,"CreateDynamicMaterialInstance",index,material,"None")
     assert(valid(child),"Could not create vertex parameter instance")
     slot={component=component,index=index,source=material,material=child}
     self.grid_slots[key]=slot
     update_grid_material(child,true)
    end
   end
  end
 end
 local function update_grid_instances()
  if self.grid_cursor>#self.grid_queue then
   if self.grid_scan_at and self.time<self.grid_scan_at then return end
   local hook=env.hook or UEVR_UObjectHook or (env.uevr.sdk and env.uevr.sdk.UObjectHook)
   assert(hook and hook.get_objects_by_class,"Vertex material discovery unavailable")
   local world=object_world(self.pawn)
   assert(valid(world),"Cannot scope vertex materials to current world")
   local objects=hook.get_objects_by_class(class("Engine.MeshComponent"),false)
   assert(type(objects)=="table","Invalid vertex component snapshot")
   self.grid_queue={};self.grid_cursor=1;self.grid_world=world
   -- UEVR produces one native snapshot; Lua inspection/mutation is bounded to
   -- 4096 components per sweep, eight per tick, and sixteen slots per component.
   local rat=property(self.pawn,"Rat2D")
   if valid(rat) then self.grid_queue[1]=rat end
   for i=1,math.min(#objects,4096) do
    if #self.grid_queue>=4096 then break end
    if not same(objects[i],rat) then self.grid_queue[#self.grid_queue+1]=objects[i] end
   end
   self.grid_scan_at=self.time+5
   self.diagnostics.vertex_scan_limited=#objects>4095
  end
  local last=math.min(#self.grid_queue,self.grid_cursor+7)
  for i=self.grid_cursor,last do
   update_grid_component(self.grid_queue[i],self.grid_world)
   self.grid_cursor=i+1
  end
  self.diagnostics.vertex_instances="fine grid applied; "..self.grid_count.." material instances"
  local report=tostring(self.grid_count)..":"..tostring(self.diagnostics.vertex_scan_limited)
  if not self.grid_report or (self.grid_cursor>#self.grid_queue and self.grid_report~=report) then
   self.grid_report=report
   log("CustomGridSize="..M.vertex_grid.." read back on "..self.grid_count..
    " tracked material instances; scan "..(self.grid_cursor>#self.grid_queue and "complete" or "in progress")..
    (self.diagnostics.vertex_scan_limited and " (4096-component limit)" or ""))
  end
 end
 local function full_name(object)
  if not valid(object) then return nil end
  local ok,result=pcall(function() return object:get_full_name() end)
  return ok and result or nil
 end
 local function restore_fill(entry)
  for i=#entry.lights,1,-1 do
   local light=entry.lights[i]
   if valid(light) then
    pcall(call,light,"SetVisibility",false,false)
    pcall(call,light,"K2_DestroyComponent",light)
   end
  end
  entry.lights={}
  if valid(entry.component) and full_name(entry.component)==entry.identity and entry.channels then
   -- Restore only our added channel; keep later native changes to other flags.
   local now=property(entry.component,"LightingChannels")
   if now and type(now.bChannel0)=="boolean" and type(now.bChannel1)=="boolean" then
    local channel1=entry.channel==1 and entry.channels[2] or now.bChannel1
    local channel2=entry.channel==2 and entry.channels[3] or now.bChannel2
    -- Explicit branches retain false values (Lua's and/or is not a ternary).
    if entry.channel==1 then channel1=entry.channels[2] end
    if entry.channel==2 then channel2=entry.channels[3] end
    local ok,err=pcall(call,entry.component,"SetLightingChannels",now.bChannel0,channel1,channel2)
    if not ok then log("Restore "..entry.kind.." lighting channel: "..tostring(err)) end
   end
  end
 end
 local function restore_lights()
  if self.rat_fill then restore_fill(self.rat_fill) end
  self.rat_fill=nil;self.rat=nil;self.saved_channels=nil;self.lights={}
 end
 local function restore_photos()
  for _,entry in pairs(self.photo_targets) do restore_fill(entry) end
  self.photo_targets={};self.photo_retry={};self.photo_queue={};self.photo_cursor=1;self.photo_count=0
  self.photo_scan_at=nil;self.photo_world=nil;self.photo_report=nil
  self.photo_balance_at=nil;self.photo_balance_dirty=true
 end
 local function fill_healthy(entry)
  if not entry or #entry.lights~=2 then return false end
  for _,light in ipairs(entry.lights) do
   if not valid(light) then return false end
   local ok,registered=pcall(optional,light,"IsRegistered")
   if not ok or registered==false then return false end
  end
  return true
 end
 local function build_fill(entry,center,normal,radius)
  local component=entry.component
  local channels=property(component,"LightingChannels")
  assert(channels and type(channels.bChannel0)=="boolean" and type(channels.bChannel1)=="boolean" and
   type(channels.bChannel2)=="boolean","Cannot snapshot "..entry.kind.." lighting channels")
  entry.channels={channels.bChannel0,channels.bChannel1,channels.bChannel2}
  entry.center=center;entry.normal=normal;entry.applied_intensity=self.cfg.fill_intensity
  entry.channel=entry.kind=="photo" and 1 or 2
  call(component,"SetLightingChannels",channels.bChannel0,channels.bChannel1 or entry.channel==1,channels.bChannel2 or entry.channel==2)
  local mathlib=default("Engine.KismetMathLibrary")
  local maker=mathlib:get_class():find_function("MakeColor") and "MakeColor" or "MakeLinearColor"
  local white=call(mathlib,maker,1,1,1,1)
  local lightclass=class("Engine.PointLightComponent")
  for _,sign in ipairs({1,-1}) do
   local transform=call(component,"K2_GetComponentToWorld")
   local light=call(self.pawn,"AddComponentByClass",lightclass,true,transform,false)
   assert(valid(light),"Could not create "..entry.kind.." fill light")
   entry.lights[#entry.lights+1]=light
   call(light,"SetVisibility",false,false)
   call(light,"SetMobility",2)
   call(light,"SetLightingChannels",false,entry.channel==1,entry.channel==2)
   call(light,"SetCastShadows",false)
   call(light,"SetLightColor",white,false)
   call(light,"SetUseInverseSquaredFalloff",false)
   call(light,"SetLightFalloffExponent",.5)
   call(light,"SetAttenuationRadius",radius)
   optional(light,"SetInverseExposureBlend",1)
   optional(light,"SetIndirectLightingIntensity",0)
   optional(light,"SetVolumetricScatteringIntensity",0)
   call(light,"SetIntensity",self.cfg.fill_intensity)
   call(light,"K2_AttachToComponent",component,"None",2,2,2,false)
   local pose={Translation=V.add(center,V.mul(normal,sign*35)),Rotation={x=0,y=0,z=0,w=1},Scale3D=V.new(1,1,1)}
   env.write_transform(transform,pose)
   call(light,"K2_SetRelativeTransform",transform,false,{},true)
   call(light,"SetVisibility",true,false)
  end
 end
 local function build_lights(rat)
  self.rat=rat
  local entry={component=rat,identity=full_name(rat),kind="rat",lights={}}
  self.rat_fill=entry;self.lights=entry.lights
  -- Actual source geometry; the original sprite/tail and material stay native.
  build_fill(entry,V.new(-9.99711799621582,5.67260479927063,-2.886479377746582),
   V.new(-.9982777946033747,-.057925455852073426,.009278273877827427),80)
  self.saved_channels=entry.channels
  self.diagnostics.rat_lighting="native scene lighting plus reduced fill (approximation)"
  self.errors.rat_lighting=nil
  log("Rat lighting: native scene channels + two fill lights, intensity "..self.cfg.fill_intensity..
   "; supplemental strength "..self.cfg.fill_strength..", not an exact scene-light blend; native sprite/frame/choke/tail retained")
 end
 local function photo_spec(component)
  if not valid(component) then return nil end
  local visible=optional(component,"IsVisible")
  if visible==false or property(component,"bVisible")==false then return nil end
  local asset=property(component,"StaticMesh") or optional(component,"GetStaticMesh")
  local identity=full_name(asset)
  return M.photo_meshes[identity],identity
 end
 local function forget_photo(key)
  local entry=self.photo_targets[key]
  if entry then
   restore_fill(entry);self.photo_targets[key]=nil;self.photo_count=self.photo_count-1;self.photo_balance_dirty=true
  end
 end
 local function update_photo(component,world)
  if not valid(component) or not same(object_world(component),world) then return end
  local center,asset_identity=photo_spec(component)
  local key=component:get_address()
  local entry=self.photo_targets[key]
  if entry and (entry.asset_identity~=asset_identity or entry.identity~=full_name(component) or not center or not fill_healthy(entry)) then
   forget_photo(key);entry=nil
  end
  if not center or entry or self.time<(self.photo_retry[key] or 0) then return end
  if self.photo_count>=M.max_photo_targets then self.diagnostics.photo_limit_reached=true;return end
  entry={component=component,identity=full_name(component),asset_identity=asset_identity,kind="photo",lights={}}
  local ok,err=pcall(build_fill,entry,V.read(center),V.new(1,0,0),50)
  if ok then
   self.photo_targets[key]=entry;self.photo_count=self.photo_count+1;self.photo_retry[key]=nil
   self.photo_balance_dirty=true
   self.errors["photo lighting "..tostring(key)]=nil
  else
   restore_fill(entry);self.photo_retry[key]=self.time+5
   error_once("photo lighting "..tostring(key),err)
  end
 end
 local function balance_photo_fill()
  if not self.photo_balance_dirty and self.photo_balance_at and self.time<self.photo_balance_at then return end
  self.photo_balance_dirty=false;self.photo_balance_at=self.time+.25
  local entries={}
  for _,entry in pairs(self.photo_targets) do
   local t=call(entry.component,"K2_GetComponentToWorld")
   local scale=V.read(t.Scale3D);local center=entry.center
   entry.world_center=V.add(V.read(t.Translation),Q.rotate(t.Rotation,V.new(center.x*scale.x,center.y*scale.y,center.z*scale.z)))
   entry.world_normal=V.normalize(Q.rotate(t.Rotation,entry.normal))
   entries[#entries+1]=entry
  end
  for _,entry in ipairs(entries) do
   local overlapping=0
   for _,other in ipairs(entries) do
    -- Held pieces occupy one photo plane. Share one pair's brightness when
    -- centres are within 5 cm and normals within ~18 degrees (either winding).
    if V.length(V.sub(entry.world_center,other.world_center))<=5 and
     math.abs(V.dot(entry.world_normal,other.world_normal))>=.95 then overlapping=overlapping+1 end
   end
   local intensity=self.cfg.fill_intensity/math.max(1,overlapping)
   if entry.applied_intensity~=intensity then
    for _,light in ipairs(entry.lights) do if valid(light) then call(light,"SetIntensity",intensity) end end
    entry.applied_intensity=intensity
   end
   entry.overlapping=overlapping
  end
 end
 local function update_photo_lights()
  local world=object_world(self.pawn)
  assert(valid(world),"Cannot scope photo lights to current world")
  -- Retire hidden, destroyed, changed-mesh and foreign-world targets promptly.
  local rebuild={}
  for key,entry in pairs(self.photo_targets) do
   local center,asset_identity=photo_spec(entry.component)
   if not center or asset_identity~=entry.asset_identity or full_name(entry.component)~=entry.identity or
    not same(object_world(entry.component),world) then forget_photo(key) end
   if self.photo_targets[key] and not fill_healthy(entry) then
    rebuild[#rebuild+1]=entry.component;forget_photo(key)
   end
  end
  for _,component in ipairs(rebuild) do update_photo(component,world) end
  -- Native held-fragment fields are known from CHAR_RatshakerPlayer imports.
  -- Check these each tick so raising a photo does not wait for a world sweep.
  for index=1,4 do update_photo(property(self.pawn,"SM_PhotoPart"..index),world) end
  if self.photo_cursor>#self.photo_queue and (not self.photo_scan_at or self.time>=self.photo_scan_at) then
   local hook=env.hook or UEVR_UObjectHook or (env.uevr.sdk and env.uevr.sdk.UObjectHook)
   assert(hook and hook.get_objects_by_class,"Photo component discovery unavailable")
   local objects=hook.get_objects_by_class(class("Engine.MeshComponent"),false)
   assert(type(objects)=="table","Invalid photo component snapshot")
   self.photo_queue={};self.photo_cursor=1;self.photo_scan_at=self.time+5
   self.diagnostics.photo_scan_limited=#objects>4096
   self.diagnostics.photo_limit_reached=false
   for i=1,math.min(#objects,4096) do self.photo_queue[i]=objects[i] end
  end
  local last=math.min(#self.photo_queue,self.photo_cursor+7)
  for i=self.photo_cursor,last do
   update_photo(self.photo_queue[i],world);self.photo_cursor=i+1
  end
  balance_photo_fill()
  self.diagnostics.photo_lighting="native scene lighting plus reduced fill; "..self.photo_count.." photo meshes"
  if self.diagnostics.photo_limit_reached then self.diagnostics.photo_lighting=self.diagnostics.photo_lighting.." (8-target limit)" end
 end
 local function apply_fill_strength()
  local fraction=self.cfg.fill_strength
  self.fill_dirty=false
  if fraction==0 then
   restore_lights();restore_photos()
   self.diagnostics.rat_lighting="native scene lighting";self.diagnostics.photo_lighting="native scene lighting"
   return
  end
  if self.rat_fill then
   local ok,err=pcall(function()
    for _,light in ipairs(self.lights) do if valid(light) then call(light,"SetIntensity",self.cfg.fill_intensity) end end
   end)
   if not ok then restore_lights();error_once("rat_lighting",err) end
  end
  for key,entry in pairs(self.photo_targets) do
   local ok,err=pcall(function()
    for _,light in ipairs(entry.lights) do if valid(light) then call(light,"SetIntensity",self.cfg.fill_intensity) end end
   end)
   entry.applied_intensity=nil;self.photo_balance_dirty=true
   if not ok then forget_photo(key);self.photo_retry[key]=self.time+5;error_once("photo lighting "..tostring(key),err) end
  end
 end
 function self:update(pawn,controller,dt)
  self.time=self.time+math.max(0,dt or 0)
  if not valid(pawn) then self:pause();return end
  if self.pawn and not same(self.pawn,pawn) then self:cleanup() end
  self.pawn=pawn
  if self.fill_dirty then apply_fill_strength() end
  if not self.parameter_check_at or self.time>=self.parameter_check_at then
   if self.time>=(self.retry.pixelation or 0) then
    local ok,err=pcall(update_parameters)
    if not ok then restore_parameters();self.diagnostics.pixelation="unavailable";error_once("pixelation",err) end
   end
   self.parameter_check_at=self.time+1
  end
  if self.time>=(self.retry.vertex_grid or 0) and
   (not self.grid_check_at or self.time>=self.grid_check_at) then
   local ok,err=pcall(update_grid_parameter)
   if ok then self.grid_check_at=self.time+1
   else restore_grid_parameter();error_once("vertex_grid",err) end
  end
  if self.time>=(self.retry.vertex_instances or 0) then
   local ok,err=pcall(update_grid_instances)
   if not ok then
    restore_grid_instances();self.diagnostics.vertex_instances="unavailable";error_once("vertex_instances",err)
   end
  end
  self.diagnostics.vertex_snap=(self.grid_parameter and "fine global grid; " or "global grid unavailable; ")..
   (self.diagnostics.vertex_instances or "instance scan pending")
  local rat=property(pawn,"Rat2D")
  if self.rat and not same(self.rat,rat) then restore_lights() end
  if self.rat_fill and not fill_healthy(self.rat_fill) then restore_lights() end
  if self.cfg.fill_strength>0 and valid(rat) and #self.lights==0 and self.time>=(self.retry.rat_lighting or 0) then
   local ok,err=pcall(build_lights,rat)
   if not ok then restore_lights();self.diagnostics.rat_lighting="unavailable";error_once("rat_lighting",err) end
  end
  if self.cfg.fill_strength>0 and self.time>=(self.retry.photo_lighting or 0) then
   local ok,err=pcall(update_photo_lights)
   if not ok then self.diagnostics.photo_lighting="discovery unavailable";error_once("photo_lighting",err) end
  end
  if self.cfg.fill_strength==0 then
   self.diagnostics.rat_lighting="native scene lighting";self.diagnostics.photo_lighting="native scene lighting"
  end
 end
 function self:set_fill_strength(fraction)
  assert(finite(fraction) and fraction>=0 and fraction<=1,"Fill strength must be between 0 and 1")
  -- UI callbacks change configuration only. All reflected writes remain on the
  -- next normal game-thread update; opening the UEVR menu may pause rendering.
  self.cfg.fill_strength=fraction;self.cfg.fill_intensity=M.fill_reference_intensity*fraction
  self.fill_dirty=true
 end
 function self:set_pixel_resolution(value)
  assert(type(value)=="number" and value==value and value>=512 and value<=32768,
   "Pixel resolution must be between 512 and 32768")
  self.cfg.pixel_resolution=value
  for _,p in ipairs(self.parameters) do p.target=value end
  self.parameter_check_at=nil
 end
 function self:pause()
  restore_parameters();restore_grid();restore_lights();restore_photos();self.parameter_check_at=nil
  self.diagnostics.pixelation="restored";self.diagnostics.rat_lighting="restored";self.diagnostics.vertex_snap="restored";self.diagnostics.vertex_instances="restored"
  self.diagnostics.photo_lighting="restored"
 end
 function self:cleanup()
  self:pause();self.pawn=nil;self.retry={};self.errors={}
 end
 return self
end
return M
