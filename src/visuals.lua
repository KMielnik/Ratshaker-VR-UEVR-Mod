-- Shared pointer asset/component factory and read-only native rat diagnostics.
-- No callbacks, HUD writes, replacement meter, or duplicate rat geometry.
local M={}

function M.new(env)
 assert(env and env.uevr and env.IK and env.call and env.valid and env.snapshot and env.write_transform,
  "visuals requires uevr, IK, call, valid, snapshot and write_transform")
 local api,call,valid,write=env.uevr.api,env.call,env.valid,env.write_transform
 local V=env.IK.vector
 local self={parts={},owned={},part_resources={},assets={},reload_assets={},materials={},pawn=nil,back=nil,backs={},
  errors={},status="Visuals not bound",time=0,diagnostics={}}
 local overlay_path="/Engine/EngineDebugMaterials/M_SimpleUnlitTranslucent.M_SimpleUnlitTranslucent"
 local overlay_identity="Material "..overlay_path
 local function log(msg) if env.log then env.log("[Visuals] "..msg) end end
 local function same(a,b) return valid(a) and valid(b) and a:get_address()==b:get_address() end
 local function full_name(obj)
  if not valid(obj) then return nil end
  local ok,s=pcall(function() return obj:get_full_name() end)
  return ok and type(s)=="string" and s or nil
 end
 local function name(obj) return full_name(obj) or tostring(obj) end
 local function matches(obj,expected) return full_name(obj)==expected end
 local function identity()
  return {Translation=V.new(0,0,0),Rotation={x=0,y=0,z=0,w=1},Scale3D=V.new(1,1,1)}
 end
 local function optional(obj,method,...)
  if not valid(obj) or obj:get_class():find_function(method)==nil then return false end
  local ok,result=pcall(call,obj,method,...)
  return ok,result
 end
 local function property(obj,key)
  if not valid(obj) or obj:get_class():find_property(key)==nil then return nil end
  local ok,result=pcall(function() return obj[key] end)
  if ok then return result end
 end
 local function class(type_name)
  local result=api:find_uobject("Class /Script/"..type_name)
  assert(result,"Required visual class unavailable: "..type_name)
  return result
 end
 local function default(type_name) return class(type_name):get_class_default_object() end
 local function native_transform(pawn)
  local root=property(pawn,"RootComponent")
  if valid(root) then return call(root,"K2_GetComponentToWorld") end
  assert(valid(pawn.FirstPersonMesh),"No native FTransform provider")
  return call(pawn.FirstPersonMesh,"K2_GetComponentToWorld")
 end
 local function error_once(scope,err)
  local msg=tostring(err)
  if self.errors[scope]~=msg then self.errors[scope]=msg;log(scope..": "..msg) end
 end
 local function evict(path)
  self.assets[path]=nil
  -- A failed object may stay discoverable during streaming or address reuse.
  -- Force AssetRegistry next time; the pointer owns bounded retry timing.
  self.reload_assets[path]=true
 end
 local function load_asset(path,type_name)
  local expected=(type_name or "Object").." "..path
  local cached=self.assets[path]
  if matches(cached,expected) then return cached end
  if cached~=nil then evict(path) end
  local result
  if not self.reload_assets[path] then
   -- Native discovery can throw after level travel, before identity checks.
   -- Do not repeat that failed lookup forever: fall through to the registry.
   local ok,value=pcall(function()return api:find_uobject(expected)end)
   if ok then result=value else evict(path);log("Discovery failed; registry reload: "..expected) end
  end
  if not matches(result,expected) then
   evict(path)
   -- UEVR 1.05 cannot marshal SoftObjectProperty. AssetRegistry uses supported
   -- FName/FAssetData and loads through the registry's native interface.
   local helpers=default("AssetRegistry.AssetRegistryHelpers")
   local registry=call(helpers,"GetAssetRegistry")
   assert(valid(registry),"Runtime AssetRegistry unavailable")
   local data
   if registry:get_class():find_function("GetAssetByObjectPath") then
    data=call(registry,"GetAssetByObjectPath",path,false)
   else
    local interface=class("AssetRegistry.AssetRegistry")
    local fn=interface:find_function("GetAssetByObjectPath")
    if fn then data=fn(registry,path,false)
    else
     fn=interface:find_function("K2_GetAssetByObjectPath")
     assert(fn,"AssetRegistry interface asset lookup unavailable")
     local soft_path=call(default("Engine.KismetSystemLibrary"),"MakeSoftObjectPath",path)
     data=fn(registry,soft_path,false,false)
    end
   end
   result=call(helpers,"GetAsset",data)
  end
  assert(matches(result,expected),"Packaged visual asset identity mismatch: expected "..expected..", got "..name(result))
  self.assets[path]=result;self.reload_assets[path]=nil
  return result
 end
 function self:load_asset(path,type_name)
  local ok,result=pcall(load_asset,path,type_name)
  if not ok then evict(path);error("Asset "..path..": "..tostring(result),0) end
  return result
 end
 function self:get_overlay_material()
  local ok,result=pcall(function()
   local material=self:load_asset(overlay_path,"Material")
   local key=material:get_address()
   local old=property(material,"bDisableDepthTest")
   local blend=property(material,"BlendMode")
   local shading=property(material,"ShadingModel")
   -- Recheck cached objects too: a recorded rebind returned BlendMode=0 after
   -- an earlier successful translucent load. Never force cooked shader fields.
   assert(type(old)=="boolean","Overlay material has no reflected bDisableDepthTest; cannot guarantee occlusion behavior")
   assert(blend==2 or blend==4 or blend==5,
    "Overlay material is not translucent (BlendMode="..tostring(blend)..")")
   assert(shading==0,"Overlay material is not unlit (ShadingModel="..tostring(shading)..")")
   local entry=self.materials[key]
   if entry and (entry.identity~=overlay_identity or not matches(entry.object,entry.identity)) then
    self.materials[key]=nil;entry=nil
   end
   if not entry then
    entry={object=material,identity=overlay_identity,disable_depth=old}
    self.materials[key]=entry
   end
   if old~=true then material.bDisableDepthTest=true end
   assert(property(material,"bDisableDepthTest")==true,"Overlay depth-test override was rejected")
   self.diagnostics.overlay={name=name(material),depth_flag=true,original_depth_flag=entry.disable_depth,
    blend=blend,shading=shading,occlusion_verified=false}
   if not entry.reported then
    log("Overlay material "..name(material).." BlendMode="..tostring(blend).." ShadingModel="..tostring(shading)..
     " DisableDepthTest=true (rendered occlusion requires runtime verification)")
    entry.reported=true
   end
   return material
  end)
  if not ok then
   evict(overlay_path);self.diagnostics.overlay=nil
   error(result,0)
  end
  return result
 end
 function self:set_world(component,pose)
  local native=call(component,"K2_GetComponentToWorld")
  write(native,pose)
  call(component,"K2_SetWorldTransform",native,false,{},true)
 end
 function self:set_relative(component,pose)
  local native=call(component,"K2_GetComponentToWorld")
  write(native,pose)
  call(component,"K2_SetRelativeTransform",native,false,{},true)
 end
 local function remove(list,component)
  for i=#list,1,-1 do if list[i]==component then table.remove(list,i) end end
 end
 function self:make_part(pawn,parent,mesh,material,part_name,pose,color)
  local comp,stage,resource=nil,"allocate",nil
  local function part_call(o,method,...)
   stage=method;return call(o,method,...)
  end
  local ok,result=pcall(function()
   comp=part_call(pawn,"AddComponentByClass",class("Engine.StaticMeshComponent"),true,native_transform(pawn),false)
   assert(valid(comp),"Could not create visual component "..tostring(part_name))
   self.owned[#self.owned+1]=comp
   part_call(comp,"SetVisibility",false,false)
   part_call(comp,"SetStaticMesh",mesh)
   part_call(comp,"SetCollisionEnabled",0);part_call(comp,"SetGenerateOverlapEvents",false)
   part_call(comp,"SetCastShadow",false)
   optional(comp,"SetReceivesDecals",false)
   -- These are local, script-owned presentation components. View ownership
   -- can change during death/spectator/respawn; it must not cull the pointer.
   optional(comp,"SetOnlyOwnerSee",false)
   optional(comp,"SetOwnerNoSee",false)
   optional(comp,"SetHiddenInGame",false,false)
   optional(comp,"SetTranslucentSortPriority",1000)
   if material then
    local dyn=part_call(comp,"CreateDynamicMaterialInstance",0,material,"None")
    assert(valid(dyn),"Material instance could not be created for "..tostring(part_name))
    if color then
     local mathlib=default("Engine.KismetMathLibrary")
     local maker=mathlib:get_class():find_function("MakeColor") and "MakeColor" or "MakeLinearColor"
     local r,g,b,a=color[1] or color.r or color.R,color[2] or color.g or color.G,color[3] or color.b or color.B,
      color[4] or color.a or color.A or 1
     local linear=part_call(mathlib,maker,r,g,b,a)
     part_call(dyn,"SetVectorParameterValue","Color",linear)
    end
    resource={mesh=mesh,material=dyn}
   end
   if valid(parent) then
    part_call(comp,"K2_AttachToComponent",parent,"None",2,2,2,false)
    stage="relative transform"
    self:set_relative(comp,pose or identity())
   else stage="world transform";self:set_world(comp,pose or identity()) end
   part_call(comp,"SetVisibility",true,false)
   self.parts[#self.parts+1]=comp
   self.part_resources[comp:get_address()]=resource or {mesh=mesh}
   return comp
  end)
  if not ok then
   -- The caller never receives a partially configured component. Destroy it
   -- here even when a MID/color/attachment/transform operation throws.
   local destroyed=true
   if valid(comp) then
    pcall(call,comp,"SetVisibility",false,false)
    destroyed=pcall(call,comp,"K2_DestroyComponent",comp)
   end
   -- Keep the ownership handle if native destruction itself throws so a later
   -- lifecycle cleanup can retry instead of losing the partially built object.
   if destroyed then remove(self.owned,comp) end
   remove(self.parts,comp)
   error("Component "..tostring(part_name).." / "..stage..": "..tostring(result),0)
  end
  return result
 end
 function self:part_healthy(component)
  if not valid(component) then return false,"component lost" end
  local r=self.part_resources[component:get_address()]
  if not r then return false,"component ownership lost" end
  if not valid(r.mesh) or (r.material and not valid(r.material)) then return false,"mesh/material lost" end
  if component:get_class():find_function("GetStaticMesh") then
   local ok,mesh=pcall(call,component,"GetStaticMesh")
   if not ok or not same(mesh,r.mesh) then return false,"mesh replaced/unreadable" end
  end
  if component:get_class():find_function("GetMaterial") then
   local ok,material=pcall(call,component,"GetMaterial",0)
   if not ok or (r.material and not same(material,r.material)) then return false,"material replaced/unreadable" end
  end
  if component:get_class():find_function("IsRegistered") then
   local ok,value=pcall(call,component,"IsRegistered")
   if not ok or value==false then return false,"component unregistered/unreadable" end
  end
  return true
 end
 function self:forget_part(component)
  if component then pcall(function()self.part_resources[component:get_address()]=nil end) end
 end
 local function asset_for(mesh)
  local ok,asset=optional(mesh,"GetSkeletalMeshAsset")
  if not ok or not valid(asset) then local found;found,asset=optional(mesh,"GetSkinnedAsset") end
  if not valid(asset) then asset=property(mesh,"SkeletalMesh") end
  if not valid(asset) then asset=property(mesh,"SkinnedAsset") end
  assert(valid(asset),"Rat2D has no skeletal asset")
  return asset
 end
 function self:build_back(pawn)
  local source=pawn.Rat2D
  assert(valid(source),"Rat2D component unavailable")
  local asset=asset_for(source)
  -- Compatibility sentinel only: the borrowed native component is never added
  -- to owned/parts/backs, transformed, hidden, cloned, or destroyed here.
  self.rat,self.rat_asset,self.backs,self.back=source,asset,{},source
  self.diagnostics.rat={asset=name(asset),mode="native front only",owned_components=0,
   pose_frames=0,source_frames=0,backface_rendered=false,two_sided_complete=false}
  log("RatBack=native front only; original animation, physics, materials and visibility retained")
 end
 function self:update(pawn,controller,dt)
  if not valid(pawn) then self:cleanup();return end
  if not same(self.pawn,pawn) then self:cleanup();self.pawn=pawn end
  dt=type(dt)=="number" and dt==dt and math.max(0,math.min(dt,.2)) or 0
  self.time=self.time+dt
  if not same(self.back,pawn.Rat2D) and self.time>=(self.next_retry or 0) then
   local ok,err=pcall(self.build_back,self,pawn)
   if not ok then
    self.back,self.rat,self.rat_asset=nil,nil,nil;self.diagnostics.rat=nil
    error_once("rat back",err);self.next_retry=self.time+10
   else self.errors["rat back"]=nil;self.next_retry=nil end
  end
  self.status="HUD=original unmodified RatBack="..(valid(self.back) and "native front only" or "unavailable")
 end
 function self:post_update()
  if not valid(self.back) or not valid(self.rat) then return end
  self.diagnostics.rat.source_frames=self.diagnostics.rat.source_frames+1
 end
 function self:set_visible(visible)
  for _,component in ipairs(self.parts) do if valid(component) then call(component,"SetVisibility",visible,false) end end
 end
 function self:cleanup()
  for i=#self.owned,1,-1 do
   local component=self.owned[i]
   if valid(component) then pcall(call,component,"K2_DestroyComponent",component) end
  end
  for _,entry in pairs(self.materials) do
   -- is_valid/address alone cannot establish ownership after GC/address reuse.
   if matches(entry.object,entry.identity) then
    pcall(function() entry.object.bDisableDepthTest=entry.disable_depth end)
   end
  end
  self.parts,self.owned,self.part_resources,self.assets,self.reload_assets,self.materials,self.backs={},{},{},{},{},{},{}
  self.pawn,self.back,self.rat,self.rat_asset=nil,nil,nil,nil
  self.errors,self.diagnostics={},{};self.time=0;self.next_retry=nil;self.status="Visuals restored"
 end
 return self
end
return M
